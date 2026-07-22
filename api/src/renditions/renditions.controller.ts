import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { CreateRenditionDto } from './dto';
import { RenditionsService } from './renditions.service';

@Controller()
export class RenditionsController {
  constructor(private readonly renditions: RenditionsService) {}

  @Post('renditions')
  create(@Body() body: CreateRenditionDto) {
    return this.renditions.create(body);
  }

  @Get('share/renditions/:id')
  share(@Param('id') id: string) {
    return this.renditions.getShare(id);
  }

  @Get('renditions/:id')
  get(@Param('id') id: string) {
    return this.renditions.get(id);
  }

  @Get('operator/renditions/failed')
  listFailed(
    @Headers('x-operator-token') token: string | undefined,
    @Query('limit') limit?: string,
  ) {
    assertOperator(token);
    return this.renditions.listFailed(limit ? Number(limit) : 50);
  }

  @Post('operator/renditions/:id/retry')
  retry(
    @Headers('x-operator-token') token: string | undefined,
    @Param('id') id: string,
  ) {
    assertOperator(token);
    return this.renditions.retry(id);
  }

  @Get('operator/metrics')
  metrics(
    @Headers('x-operator-token') token: string | undefined,
    @Query('hours') hours?: string,
  ) {
    assertOperator(token);
    return this.renditions.metrics(hours ? Number(hours) : 24);
  }
}

function assertOperator(token?: string) {
  const expected = process.env.OPERATOR_TOKEN;
  if (!expected || !token || token !== expected) {
    throw new UnauthorizedException('Invalid operator token');
  }
}
