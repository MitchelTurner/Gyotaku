import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../session/session.service';
import { StorageService } from '../storage/storage.service';
import {
  METRICS_LATENCY_KEY,
  PYTHON_DEADLETTER_QUEUE,
  PYTHON_JOB_QUEUE,
  RENDITION_JOB,
  RENDITION_QUEUE,
} from '../queue/queue.constants';
import { CreateRenditionDto } from './dto';

export type RenditionJobPayload = {
  type?: 'generate' | 'print';
  renditionId: string;
  uploadId: string;
  s3Key: string;
  styleParams: Record<string, unknown>;
  seed: number;
  imageHash: string;
};

@Injectable()
export class RenditionsService implements OnModuleDestroy {
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly storage: StorageService,
    @InjectQueue(RENDITION_QUEUE) private readonly queue: Queue,
  ) {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  async create(dto: CreateRenditionDto) {
    const upload = await this.prisma.upload.findUnique({
      where: { id: dto.uploadId },
    });
    if (!upload) throw new NotFoundException('Upload not found');
    if (upload.sessionId !== dto.sessionId) {
      throw new BadRequestException('sessionId does not match upload');
    }
    if (!upload.imageHash || !upload.width) {
      throw new BadRequestException(
        'Upload is incomplete — call POST /uploads/:id/complete first',
      );
    }

    await this.sessions.assertRenditionAllowance(dto.sessionId);

    const styleParams = (dto.styleParams || {}) as Prisma.InputJsonObject;
    const seed = dto.seed ?? Math.floor(Math.random() * 1_000_000_000);
    const styleFingerprint = fingerprint(styleParams as Record<string, unknown>);

    // Cache hit: same image + params + seed
    const existing = await this.prisma.rendition.findUnique({
      where: {
        uploadId_seed_styleFingerprint: {
          uploadId: upload.id,
          seed,
          styleFingerprint,
        },
      },
    });
    if (existing && (existing.status === 'READY' || existing.status === 'REJECTED')) {
      return this.toResponse(existing);
    }
    if (existing && (existing.status === 'QUEUED' || existing.status === 'PROCESSING')) {
      return this.toResponse(existing);
    }

    const rendition = existing
      ? await this.prisma.rendition.update({
          where: { id: existing.id },
          data: {
            status: 'QUEUED',
            stage: 'queued',
            failureReason: null,
            completedAt: null,
            styleParams,
          },
        })
      : await this.prisma.rendition.create({
          data: {
            uploadId: upload.id,
            seed,
            styleParams,
            styleFingerprint,
            status: 'QUEUED',
            stage: 'queued',
          },
        });

    const payload: RenditionJobPayload = {
      renditionId: rendition.id,
      uploadId: upload.id,
      s3Key: upload.s3Key,
      styleParams: styleParams as Record<string, unknown>,
      seed,
      imageHash: upload.imageHash,
    };

    await this.queue.add(RENDITION_JOB, payload, {
      jobId: rendition.id,
      removeOnComplete: 1000,
      removeOnFail: 1000,
      attempts: 2,
      backoff: { type: 'exponential', delay: 5000 },
    });
    // Python worker is a plain Redis list consumer (no HTTP).
    await this.redis.lpush(PYTHON_JOB_QUEUE, JSON.stringify(payload));

    return this.toResponse(rendition);
  }

  async get(id: string) {
    const rendition = await this.prisma.rendition.findUnique({
      where: { id },
    });
    if (!rendition) throw new NotFoundException('Rendition not found');
    return this.toResponse(rendition);
  }

  /** Operator: recent FAILED renditions (+ dead-letter peek). */
  async listFailed(limit = 50) {
    const take = Math.min(100, Math.max(1, limit));
    const rows = await this.prisma.rendition.findMany({
      where: { status: 'FAILED' },
      orderBy: { completedAt: 'desc' },
      take,
      include: { upload: { select: { id: true, sessionId: true, s3Key: true } } },
    });
    const deadLetterRaw = await this.redis.lrange(PYTHON_DEADLETTER_QUEUE, 0, 19);
    const deadLetter = deadLetterRaw.map((raw) => {
      try {
        return JSON.parse(raw);
      } catch {
        return { raw };
      }
    });
    return {
      failed: rows.map((r) => ({
        id: r.id,
        uploadId: r.uploadId,
        sessionId: r.upload.sessionId,
        status: r.status,
        stage: r.stage,
        failureReason: r.failureReason,
        seed: r.seed,
        createdAt: r.createdAt,
        completedAt: r.completedAt,
      })),
      deadLetter,
      deadLetterDepth: await this.redis.llen(PYTHON_DEADLETTER_QUEUE),
    };
  }

  /** Operator: re-queue a FAILED (or stuck) rendition. */
  async retry(id: string) {
    const rendition = await this.prisma.rendition.findUnique({
      where: { id },
      include: { upload: true },
    });
    if (!rendition) throw new NotFoundException('Rendition not found');
    if (!['FAILED', 'REJECTED', 'QUEUED'].includes(rendition.status)) {
      throw new BadRequestException(
        `Cannot retry status ${rendition.status} — only FAILED / REJECTED / QUEUED`,
      );
    }
    if (!rendition.upload.s3Key) {
      throw new BadRequestException('Upload missing s3Key');
    }

    const updated = await this.prisma.rendition.update({
      where: { id },
      data: {
        status: 'QUEUED',
        stage: 'queued',
        failureReason: null,
        completedAt: null,
      },
    });

    const payload: RenditionJobPayload = {
      type: 'generate',
      renditionId: updated.id,
      uploadId: rendition.upload.id,
      s3Key: rendition.upload.s3Key,
      styleParams: (rendition.styleParams || {}) as Record<string, unknown>,
      seed: rendition.seed,
      imageHash: rendition.upload.imageHash,
    };

    try {
      await this.queue.add(RENDITION_JOB, payload, {
        jobId: `${updated.id}-retry-${Date.now()}`,
        removeOnComplete: 1000,
        removeOnFail: 1000,
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
      });
    } catch {
      /* Bull jobId collision is fine — Python list is the real consumer */
    }
    await this.redis.lpush(PYTHON_JOB_QUEUE, JSON.stringify(payload));
    // Drop matching dead-letter entries
    await this.pruneDeadLetter(updated.id);

    return this.toResponse(updated);
  }

  private async pruneDeadLetter(renditionId: string) {
    const items = await this.redis.lrange(PYTHON_DEADLETTER_QUEUE, 0, 199);
    for (const raw of items) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.renditionId === renditionId || parsed?.job?.renditionId === renditionId) {
          await this.redis.lrem(PYTHON_DEADLETTER_QUEUE, 1, raw);
        }
      } catch {
        /* ignore */
      }
    }
  }

  /** Operator: p50/p95 generate latency + reject rate. */
  async metrics(hours = 24) {
    const windowHours = Math.min(168, Math.max(1, hours));
    const since = new Date(Date.now() - windowHours * 3600 * 1000);
    const rows = await this.prisma.rendition.findMany({
      where: {
        completedAt: { not: null, gte: since },
        status: { in: ['READY', 'REJECTED', 'FAILED'] },
      },
      select: {
        status: true,
        createdAt: true,
        completedAt: true,
      },
    });

    const latencies = rows
      .filter((r) => r.completedAt)
      .map((r) => r.completedAt!.getTime() - r.createdAt.getTime())
      .filter((ms) => ms >= 0 && ms < 60 * 60 * 1000)
      .sort((a, b) => a - b);

    const ready = rows.filter((r) => r.status === 'READY').length;
    const rejected = rows.filter((r) => r.status === 'REJECTED').length;
    const failed = rows.filter((r) => r.status === 'FAILED').length;
    const finished = ready + rejected + failed;

    const redisLatencies = (await this.redis.lrange(METRICS_LATENCY_KEY, 0, 499))
      .map((v) => Number(v))
      .filter((n) => Number.isFinite(n) && n >= 0)
      .sort((a, b) => a - b);

    const queueDepth = await this.redis.llen(PYTHON_JOB_QUEUE);
    const deadLetterDepth = await this.redis.llen(PYTHON_DEADLETTER_QUEUE);

    return {
      windowHours,
      sampleSize: latencies.length,
      generateMs: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        max: latencies.length ? latencies[latencies.length - 1] : null,
      },
      workerSampleMs: {
        p50: percentile(redisLatencies, 0.5),
        p95: percentile(redisLatencies, 0.95),
        sampleSize: redisLatencies.length,
      },
      outcomes: {
        ready,
        rejected,
        failed,
        rejectRate: finished ? rejected / finished : null,
        failRate: finished ? failed / finished : null,
      },
      queue: {
        depth: queueDepth,
        deadLetterDepth,
      },
    };
  }

  /** Public share card — watermarked preview only, no SVG. */
  async getShare(id: string) {
    const rendition = await this.prisma.rendition.findUnique({
      where: { id },
    });
    if (!rendition) throw new NotFoundException('Rendition not found');
    if (rendition.status !== 'READY' || !rendition.previewKey) {
      throw new NotFoundException('Share preview not available');
    }

    const style = (rendition.styleParams || {}) as Record<string, unknown>;
    const fishLengthIn =
      typeof style.fish_length_in === 'number' ? style.fish_length_in : null;
    const previewUrl = await this.storage.presignGet(rendition.previewKey);

    return {
      id: rendition.id,
      status: rendition.status,
      seed: rendition.seed,
      previewUrl,
      estPlotSeconds: rendition.estPlotSeconds,
      paperWidthMm: rendition.paperWidthMm,
      paperHeightMm: rendition.paperHeightMm,
      fishLengthIn,
      styleParams: {
        strategy: style.strategy ?? null,
      },
    };
  }

  private async toResponse(rendition: {
    id: string;
    uploadId: string;
    seed: number;
    styleParams: unknown;
    status: string;
    stage: string | null;
    matteScore: number | null;
    svgKey: string | null;
    previewKey: string | null;
    printKey: string | null;
    estPlotSeconds: number | null;
    paperWidthMm?: number | null;
    paperHeightMm?: number | null;
    failureReason: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }) {
    let previewUrl: string | null = null;
    if (rendition.status === 'READY' && rendition.previewKey) {
      previewUrl = await this.storage.presignGet(rendition.previewKey);
    }

    const style = (rendition.styleParams || {}) as Record<string, unknown>;
    const fishLengthIn =
      typeof style.fish_length_in === 'number' ? style.fish_length_in : null;

    return {
      id: rendition.id,
      uploadId: rendition.uploadId,
      seed: rendition.seed,
      styleParams: rendition.styleParams,
      status: rendition.status,
      stage: rendition.stage,
      matteScore: rendition.matteScore,
      estPlotSeconds: rendition.estPlotSeconds,
      paperWidthMm: rendition.paperWidthMm ?? null,
      paperHeightMm: rendition.paperHeightMm ?? null,
      fishLengthIn,
      failureReason: rendition.failureReason,
      previewUrl,
      // SVG is operator / paid-only — never expose on the public rendition API
      createdAt: rendition.createdAt,
      completedAt: rendition.completedAt,
    };
  }
}

function fingerprint(params: Record<string, unknown>): string {
  const json = JSON.stringify(params, Object.keys(params).sort());
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx];
}
