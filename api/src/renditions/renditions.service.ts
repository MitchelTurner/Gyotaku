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
import { RENDITION_JOB, RENDITION_QUEUE } from '../queue/queue.constants';
import { CreateRenditionDto } from './dto';

/** Redis list consumed by the Python generator worker. */
export const PYTHON_JOB_QUEUE = 'gyotaku:jobs';

export type RenditionJobPayload = {
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
      include: { upload: true },
    });
    if (!rendition) throw new NotFoundException('Rendition not found');
    return this.toResponse(rendition);
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
    failureReason: string | null;
    createdAt: Date;
    completedAt: Date | null;
  }) {
    let previewUrl: string | null = null;
    let svgUrl: string | null = null;
    if (rendition.status === 'READY' && rendition.previewKey) {
      previewUrl = await this.storage.presignGet(rendition.previewKey);
    }
    if (rendition.status === 'READY' && rendition.svgKey) {
      svgUrl = await this.storage.presignGet(rendition.svgKey);
    }
    return {
      id: rendition.id,
      uploadId: rendition.uploadId,
      seed: rendition.seed,
      styleParams: rendition.styleParams,
      status: rendition.status,
      stage: rendition.stage,
      matteScore: rendition.matteScore,
      estPlotSeconds: rendition.estPlotSeconds,
      failureReason: rendition.failureReason,
      previewUrl,
      svgUrl,
      createdAt: rendition.createdAt,
      completedAt: rendition.completedAt,
    };
  }
}

function fingerprint(params: Record<string, unknown>): string {
  const json = JSON.stringify(params, Object.keys(params).sort());
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}
