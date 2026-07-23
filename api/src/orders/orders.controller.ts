import {
  BadRequestException,
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
import { AffiliatesService } from './affiliates.service';
import {
  CreateAffiliateDto,
  CreateCheckoutDto,
  JoinWaitlistDto,
  MarkAffiliatePaidDto,
  UpdateFulfillmentDto,
} from './dto';
import { OrdersService } from './orders.service';

@Controller()
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly affiliates: AffiliatesService,
  ) {}

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

  /** Public: resolve captain QR code for guest UI. */
  @Get('affiliates/:code')
  resolveAffiliate(@Param('code') code: string) {
    return this.affiliates.resolvePublic(code);
  }

  @Post('orders/waitlist')
  joinWaitlist(@Body() body: JoinWaitlistDto) {
    return this.orders.joinWaitlist(body);
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

  /** Prodigi CloudEvents callbacks (stage / shipment updates). */
  @Post('webhooks/prodigi')
  prodigiWebhook(@Body() body: unknown) {
    return this.orders.handleProdigiWebhook(body);
  }

  /**
   * Generator worker calls this after uploading print.png.
   * Auth: x-internal-token = INTERNAL_JOB_TOKEN or OPERATOR_TOKEN.
   */
  @Post('internal/print-ready')
  printReady(
    @Headers('x-internal-token') token: string | undefined,
    @Body() body: { renditionId?: string },
  ) {
    assertInternal(token);
    if (!body?.renditionId) {
      throw new BadRequestException('renditionId is required');
    }
    return this.orders.onPrintReady(body.renditionId);
  }

  @Post('operator/orders/:id/prodigi')
  submitProdigi(
    @Headers('x-operator-token') token: string | undefined,
    @Param('id') id: string,
  ) {
    assertOperator(token);
    return this.orders.submitProdigi(id);
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

  @Get('operator/affiliates')
  listAffiliates(@Headers('x-operator-token') token: string | undefined) {
    assertOperator(token);
    return this.affiliates.list();
  }

  @Post('operator/affiliates')
  createAffiliate(
    @Headers('x-operator-token') token: string | undefined,
    @Body() body: CreateAffiliateDto,
  ) {
    assertOperator(token);
    return this.affiliates.create(body);
  }

  @Post('operator/affiliates/:id/mark-paid')
  markAffiliatePaid(
    @Headers('x-operator-token') token: string | undefined,
    @Param('id') id: string,
    @Body() body: MarkAffiliatePaidDto,
  ) {
    assertOperator(token);
    return this.affiliates.markPaid(id, body);
  }

  @Get('operator/waitlist')
  listWaitlist(@Headers('x-operator-token') token: string | undefined) {
    assertOperator(token);
    return this.orders.listWaitlist();
  }
}

function assertOperator(token?: string) {
  const expected = process.env.OPERATOR_TOKEN;
  if (!expected || !token || token !== expected) {
    throw new UnauthorizedException('Invalid operator token');
  }
}

function assertInternal(token?: string) {
  const expected =
    process.env.INTERNAL_JOB_TOKEN || process.env.OPERATOR_TOKEN;
  if (!expected || !token || token !== expected) {
    throw new UnauthorizedException('Invalid internal token');
  }
}
