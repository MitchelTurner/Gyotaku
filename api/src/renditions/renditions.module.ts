import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RENDITION_QUEUE } from '../queue/queue.constants';
import { RenditionsController } from './renditions.controller';
import { RenditionsService } from './renditions.service';

@Module({
  imports: [
    BullModule.registerQueue({
      name: RENDITION_QUEUE,
    }),
  ],
  controllers: [RenditionsController],
  providers: [RenditionsService],
})
export class RenditionsModule {}
