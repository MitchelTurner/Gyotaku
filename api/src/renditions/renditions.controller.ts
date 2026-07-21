import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CreateRenditionDto } from './dto';
import { RenditionsService } from './renditions.service';

@Controller('renditions')
export class RenditionsController {
  constructor(private readonly renditions: RenditionsService) {}

  @Post()
  create(@Body() body: CreateRenditionDto) {
    return this.renditions.create(body);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.renditions.get(id);
  }
}
