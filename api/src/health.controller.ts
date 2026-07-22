import { Controller, Get } from '@nestjs/common';
import { StorageService } from './storage/storage.service';

@Controller()
export class HealthController {
  constructor(private readonly storage: StorageService) {}

  @Get(['/', 'health', 'healthz'])
  health() {
    const storage = this.storage.configSummary();
    return {
      status: storage.localEndpoint && process.env.RAILWAY_ENVIRONMENT
        ? 'degraded'
        : 'ok',
      phase: 1,
      service: 'gyotaku-api',
      storage,
    };
  }
}
