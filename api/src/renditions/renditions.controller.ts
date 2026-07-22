import { Body, Controller, Get, Param, Post } from '@nestjs/common';
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
}
