import {
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import Redis from 'ioredis';

/** Sliding-window rate limits per session (spec: 10 uploads/hr, 30 renditions/hr). */
@Injectable()
export class SessionService {
  private readonly redis: Redis;

  constructor() {
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
      lazyConnect: false,
    });
  }

  async assertUploadAllowance(sessionId: string) {
    await this.hit(`rl:upload:${sessionId}`, 10, 3600);
  }

  async assertRenditionAllowance(sessionId: string) {
    await this.hit(`rl:rendition:${sessionId}`, 30, 3600);
  }

  private async hit(key: string, limit: number, windowSec: number) {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, windowSec);
    }
    if (count > limit) {
      throw new HttpException(
        `Rate limit exceeded (${limit} per hour for this session)`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}
