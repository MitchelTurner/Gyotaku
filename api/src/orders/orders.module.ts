import { Module } from '@nestjs/common';
import { AffiliatesService } from './affiliates.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  controllers: [OrdersController],
  providers: [OrdersService, AffiliatesService],
  exports: [OrdersService, AffiliatesService],
})
export class OrdersModule {}
