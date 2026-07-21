import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get(['/', 'health', 'healthz'])
  health() {
    return {
      status: 'ok',
      phase: 1,
      service: 'gyotaku-api',
    };
  }
}
