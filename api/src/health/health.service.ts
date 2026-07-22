import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { PYTHON_DEADLETTER_QUEUE, PYTHON_JOB_QUEUE } from '../queue/queue.constants';

export type CheckStatus = 'ok' | 'degraded' | 'down' | 'skipped';

export type HealthCheck = {
  status: CheckStatus;
  latencyMs?: number;
  detail?: string;
};

export type HealthAlert = {
  level: 'warning' | 'critical';
  code: string;
  message: string;
};

@Injectable()
export class HealthService implements OnModuleDestroy {
  private readonly redis: Redis;
  private lastWebhookAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      connectTimeout: 3000,
      commandTimeout: 3000,
    });
  }

  async onModuleDestroy() {
    try {
      await this.redis.quit();
    } catch {
      /* ignore */
    }
  }

  async probe() {
    const [postgres, redisCheck, storage, stripe] = await Promise.all([
      this.checkPostgres(),
      this.checkRedis(),
      this.checkStorage(),
      Promise.resolve(this.checkStripe()),
    ]);

    const checks = { postgres, redis: redisCheck.check, storage, stripe };
    const alerts = this.buildAlerts(checks, redisCheck.depth, redisCheck.deadLetterDepth);

    const criticalDown = [postgres, redisCheck.check, storage].some(
      (c) => c.status === 'down',
    );
    const degraded =
      criticalDown ||
      [postgres, redisCheck.check, storage, stripe].some((c) => c.status === 'degraded') ||
      alerts.some((a) => a.level === 'critical');

    let status: 'ok' | 'degraded' | 'down' = 'ok';
    if (criticalDown) status = 'down';
    else if (degraded) status = 'degraded';

    if (alerts.some((a) => a.level === 'critical')) {
      void this.maybeAlertWebhook(alerts);
    }

    return {
      status,
      phase: 3,
      service: 'gyotaku-api',
      checks,
      alerts,
      queue: {
        depth: redisCheck.depth,
        deadLetterDepth: redisCheck.deadLetterDepth,
        depthAlertAt: intEnv('QUEUE_DEPTH_ALERT', 25),
      },
      storage: this.storage.configSummary(),
      stripe: {
        secretConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
        webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
      },
      time: new Date().toISOString(),
    };
  }

  private async checkPostgres(): Promise<HealthCheck> {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', latencyMs: Date.now() - started };
    } catch (err) {
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async checkRedis(): Promise<{
    check: HealthCheck;
    depth: number | null;
    deadLetterDepth: number | null;
  }> {
    const started = Date.now();
    try {
      await this.redis.ping();
      const depth = await this.redis.llen(PYTHON_JOB_QUEUE);
      const deadLetterDepth = await this.redis.llen(PYTHON_DEADLETTER_QUEUE);
      const alertAt = intEnv('QUEUE_DEPTH_ALERT', 25);
      const status: CheckStatus = depth >= alertAt ? 'degraded' : 'ok';
      return {
        check: {
          status,
          latencyMs: Date.now() - started,
          detail: `depth=${depth} deadletter=${deadLetterDepth}`,
        },
        depth,
        deadLetterDepth,
      };
    } catch (err) {
      return {
        check: {
          status: 'down',
          latencyMs: Date.now() - started,
          detail: err instanceof Error ? err.message : String(err),
        },
        depth: null,
        deadLetterDepth: null,
      };
    }
  }

  private async checkStorage(): Promise<HealthCheck> {
    const started = Date.now();
    const summary = this.storage.configSummary();
    if (summary.localEndpoint && process.env.RAILWAY_ENVIRONMENT) {
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        detail: 'S3_ENDPOINT points to localhost on Railway',
      };
    }
    if (this.storage.usingDefaultMinioCreds() && process.env.RAILWAY_ENVIRONMENT) {
      return {
        status: 'down',
        latencyMs: Date.now() - started,
        detail: 'Using default MinIO credentials on Railway',
      };
    }
    try {
      await this.storage.headBucket();
      return { status: 'ok', latencyMs: Date.now() - started };
    } catch (err) {
      return {
        status: 'degraded',
        latencyMs: Date.now() - started,
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private checkStripe(): HealthCheck {
    const secret = Boolean(process.env.STRIPE_SECRET_KEY);
    const webhook = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
    if (!secret && !webhook) {
      return { status: 'skipped', detail: 'STRIPE_* not set' };
    }
    if (!secret || !webhook) {
      return {
        status: 'degraded',
        detail: `secret=${secret} webhook=${webhook}`,
      };
    }
    return { status: 'ok', detail: 'configured' };
  }

  private buildAlerts(
    checks: Record<string, HealthCheck>,
    depth: number | null,
    deadLetterDepth: number | null,
  ): HealthAlert[] {
    const alerts: HealthAlert[] = [];
    if (checks.postgres.status === 'down') {
      alerts.push({
        level: 'critical',
        code: 'postgres_down',
        message: checks.postgres.detail || 'Postgres unreachable',
      });
    }
    if (checks.redis.status === 'down') {
      alerts.push({
        level: 'critical',
        code: 'redis_down',
        message: checks.redis.detail || 'Redis unreachable',
      });
    }
    if (checks.storage.status === 'down') {
      alerts.push({
        level: 'critical',
        code: 'storage_misconfigured',
        message: checks.storage.detail || 'Storage misconfigured',
      });
    } else if (checks.storage.status === 'degraded') {
      alerts.push({
        level: 'warning',
        code: 'storage_probe_failed',
        message: checks.storage.detail || 'Storage probe failed',
      });
    }
    if (this.storage.usingDefaultMinioCreds()) {
      alerts.push({
        level: process.env.RAILWAY_ENVIRONMENT ? 'critical' : 'warning',
        code: 'default_minio_creds',
        message: 'S3 credentials are still the MinIO defaults (minio/minio12345)',
      });
    }
    const alertAt = intEnv('QUEUE_DEPTH_ALERT', 25);
    if (depth != null && depth >= alertAt) {
      alerts.push({
        level: 'critical',
        code: 'queue_depth_spike',
        message: `Job queue depth ${depth} ≥ alert threshold ${alertAt}`,
      });
    }
    if (deadLetterDepth != null && deadLetterDepth >= intEnv('DEADLETTER_ALERT', 5)) {
      alerts.push({
        level: 'warning',
        code: 'deadletter_backlog',
        message: `${deadLetterDepth} jobs in dead-letter queue`,
      });
    }
    if (checks.stripe.status === 'degraded') {
      alerts.push({
        level: 'warning',
        code: 'stripe_incomplete',
        message: checks.stripe.detail || 'Stripe config incomplete',
      });
    }
    return alerts;
  }

  private async maybeAlertWebhook(alerts: HealthAlert[]) {
    const url = process.env.ALERT_WEBHOOK_URL;
    if (!url) return;
    const minInterval = intEnv('ALERT_WEBHOOK_MIN_INTERVAL_SEC', 300) * 1000;
    if (Date.now() - this.lastWebhookAt < minInterval) return;
    this.lastWebhookAt = Date.now();
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: 'gyotaku-api',
          alerts,
          time: new Date().toISOString(),
        }),
      });
    } catch {
      /* ignore */
    }
  }
}

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
