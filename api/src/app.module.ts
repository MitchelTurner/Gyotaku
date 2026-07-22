import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { UploadsModule } from './uploads/uploads.module';
import { RenditionsModule } from './renditions/renditions.module';
import { OrdersModule } from './orders/orders.module';
import { HealthModule } from './health/health.module';
import { SessionModule } from './session/session.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL || 'redis://localhost:6379',
      },
    }),
    PrismaModule,
    StorageModule,
    SessionModule,
    UploadsModule,
    RenditionsModule,
    OrdersModule,
    HealthModule,
  ],
})
export class AppModule {}
