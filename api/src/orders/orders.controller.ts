import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { OrderStatus, ProductType } from '@prisma/client';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CreateCheckoutDto, UpdateFulfillmentDto } from './dto';
import { OrdersService } from './orders.service';

@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('orders/quote')
  quote(
    @Query('productType') productType: ProductType,
    @Query('fishLengthIn') fishLengthIn?: string,
  ) {
    const length =
      fishLengthIn != null && fishLengthIn !== '' ? Number(fishLengthIn) : null;
    return this.orders.quote(productType, length);
  }

  @Get('orders/availability/plotted')
  plottedAvailability() {
    return this.orders.plottedAvailability();
  }

  @Post('orders/checkout')
  checkout(@Body() body: CreateCheckoutDto) {
    return this.orders.createCheckout(body);
  }

  @Get('orders/:id')
  getOne(@Param('id') id: string, @Query('sessionId') sessionId?: string) {
    return this.orders.getOrder(id, sessionId);
  }

  @Get('orders/:id/artifacts')
  artifacts(
    @Param('id') id: string,
    @Query('sessionId') sessionId?: string,
  ) {
    if (!sessionId) {
      throw new UnauthorizedException('sessionId is required');
    }
    return this.orders.getArtifacts(id, sessionId);
  }

  @Post('webhooks/stripe')
  stripeWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ) {
    if (!signature) {
      throw new UnauthorizedException('Missing stripe-signature header');
    }
    const raw = req.rawBody;
    if (!raw) {
      throw new UnauthorizedException(
        'Raw body unavailable — ensure Nest is started with rawBody: true',
      );
    }
    return this.orders.handleStripeWebhook(raw, signature);
  }

  @Get('operator/orders')
  listOperator(
    @Headers('x-operator-token') token: string | undefined,
    @Query('status') status?: OrderStatus,
  ) {
    assertOperator(token);
    return this.orders.listFulfillment(status);
  }

  @Patch('operator/orders/:id')
  patchOperator(
    @Headers('x-operator-token') token: string | undefined,
    @Param('id') id: string,
    @Body() body: UpdateFulfillmentDto,
  ) {
    assertOperator(token);
    return this.orders.updateFulfillment(id, body);
  }

  @Post('operator/orders/:id/label')
  createLabel(
    @Headers('x-operator-token') token: string | undefined,
    @Param('id') id: string,
  ) {
    assertOperator(token);
    return this.orders.createLabel(id);
  }

  @Post('operator/orders/:id/print')
  requestPrint(
    @Headers('x-operator-token') token: string | undefined,
    @Param('id') id: string,
  ) {
    assertOperator(token);
    return this.orders.requestPrint(id);
  }
}

function assertOperator(token?: string) {
  const expected = process.env.OPERATOR_TOKEN;
  if (!expected || !token || token !== expected) {
    throw new UnauthorizedException('Invalid operator token');
  }
}
