import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { HealthService } from './health/health.service';

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get(['/', 'health', 'healthz'])
  async healthz(@Res({ passthrough: true }) res: Response) {
    const body = await this.health.probe();
    if (body.status === 'down') {
      res.status(503);
    } else if (body.status === 'degraded') {
      res.status(200);
    }
    return body;
  }
}
