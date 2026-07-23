import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OrderStatus, ProductType } from '@prisma/client';
import Redis from 'ioredis';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AffiliatesService } from './affiliates.service';
import { commissionCents } from './commission';
import {
  CreateCheckoutDto,
  JoinWaitlistDto,
  UpdateFulfillmentDto,
} from './dto';
import { PYTHON_JOB_QUEUE, type PrintJobPayload } from './print-jobs';
import { isGicleeProduct, priceQuote, productLabel } from './pricing';
import { isPlottedQueueOpen } from './queue-eta';
import {
  purchaseShippingLabel,
  ShippingAddressError,
  ShippingNotConfiguredError,
} from './shipping';

const PAID_STATUSES: OrderStatus[] = [
  'PAID',
  'PLOTTING',
  'PRINTING',
  'PACKED',
  'SHIPPED',
];

@Injectable()
export class OrdersService implements OnModuleDestroy {
  private readonly stripe: Stripe | null;
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly affiliates: AffiliatesService,
  ) {
    const key = process.env.STRIPE_SECRET_KEY;
    this.stripe = key ? new Stripe(key) : null;
    this.redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }

  private requireStripe(): Stripe {
    if (!this.stripe) {
      throw new ServiceUnavailableException(
        'Stripe is not configured. Set STRIPE_SECRET_KEY on the API service.',
      );
    }
    return this.stripe;
  }

  async plottedAvailability() {
    const [queueOrders, counter] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          productType: 'PLOTTED_ORIGINAL',
          status: { in: ['PAID', 'PLOTTING', 'PACKED'] },
        },
        include: { rendition: { select: { estPlotSeconds: true } } },
      }),
      this.prisma.editionCounter.findUnique({ where: { id: 'plotted_original' } }),
    ]);

    const open = isPlottedQueueOpen(
      queueOrders.map((o) => ({
        status: o.status,
        estPlotSeconds: o.rendition.estPlotSeconds,
      })),
      counter?.next,
      counter?.size,
    );

    return {
      productType: 'PLOTTED_ORIGINAL' as const,
      open: open.open,
      reason: open.reason,
      queueEtaDays: open.queueEtaDays,
      maxDays: open.maxDays,
      editionNext: counter?.next ?? 1,
      editionSize: counter?.size ?? 25,
    };
  }

  async quote(productType: ProductType, fishLengthIn?: number | null) {
    const q = priceQuote(productType, fishLengthIn);
    const availability =
      productType === 'PLOTTED_ORIGINAL' ? await this.plottedAvailability() : null;
    const available = availability ? availability.open : true;
    return {
      productType,
      fishLengthIn: q.fishLengthIn,
      band: q.band,
      sku: q.sku,
      skuLabel: q.skuLabel,
      amountCents: q.amountCents,
      shippingCents: q.shippingCents,
      totalCents: q.totalCents,
      currency: 'usd',
      label: q.label,
      available,
      unavailableReason: availability?.reason ?? null,
      queueEtaDays: availability?.queueEtaDays ?? null,
      /** Join waitlist instead of hard-close when plotted queue is full / sold out. */
      waitlistOpen: productType === 'PLOTTED_ORIGINAL' && !available,
    };
  }

  async joinWaitlist(dto: JoinWaitlistDto) {
    const productType = dto.productType ?? 'PLOTTED_ORIGINAL';
    if (productType !== 'PLOTTED_ORIGINAL') {
      throw new BadRequestException('Waitlist is only for plotted originals');
    }

    const avail = await this.plottedAvailability();
    if (avail.open) {
      throw new BadRequestException(
        'Plotted originals are available — checkout instead of joining the waitlist',
      );
    }

    const q = priceQuote(productType, dto.fishLengthIn);
    const email = dto.email.trim().toLowerCase();

    const entry = await this.prisma.waitlistEntry.upsert({
      where: {
        email_productType: { email, productType },
      },
      create: {
        email,
        sessionId: dto.sessionId,
        renditionId: dto.renditionId,
        fishLengthIn: dto.fishLengthIn ?? q.fishLengthIn,
        sku: q.sku,
        productType,
        note: dto.note?.trim() || undefined,
      },
      update: {
        sessionId: dto.sessionId ?? undefined,
        renditionId: dto.renditionId ?? undefined,
        fishLengthIn: dto.fishLengthIn ?? undefined,
        sku: q.sku,
        note: dto.note?.trim() || undefined,
        notifiedAt: null,
      },
    });

    return {
      id: entry.id,
      email: entry.email,
      productType: entry.productType,
      sku: entry.sku,
      fishLengthIn: entry.fishLengthIn,
      reason: avail.reason,
      message: "You're on the waitlist. We'll email when plotted originals reopen.",
    };
  }

  async listWaitlist() {
    const entries = await this.prisma.waitlistEntry.findMany({
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return {
      count: entries.length,
      entries: entries.map((e) => ({
        id: e.id,
        email: e.email,
        productType: e.productType,
        sku: e.sku,
        fishLengthIn: e.fishLengthIn,
        renditionId: e.renditionId,
        note: e.note,
        notifiedAt: e.notifiedAt,
        createdAt: e.createdAt,
      })),
    };
  }

  async createCheckout(dto: CreateCheckoutDto) {
    const stripe = this.requireStripe();
    const webOrigin = (
      process.env.PUBLIC_WEB_URL ||
      process.env.WEB_ORIGIN ||
      'http://localhost:5173'
    ).replace(/\/$/, '');

    const rendition = await this.prisma.rendition.findUnique({
      where: { id: dto.renditionId },
      include: { upload: true },
    });
    if (!rendition) throw new NotFoundException('Rendition not found');
    if (rendition.upload.sessionId !== dto.sessionId) {
      throw new BadRequestException('sessionId does not match rendition');
    }
    if (rendition.status !== 'READY') {
      throw new BadRequestException('Rendition is not ready to order');
    }
    if (!rendition.svgKey) {
      throw new BadRequestException('Rendition has no SVG artifact');
    }

    if (dto.productType === 'PLOTTED_ORIGINAL') {
      const avail = await this.plottedAvailability();
      if (!avail.open) {
        throw new BadRequestException(
          avail.reason ||
            'Plotted originals are temporarily unavailable — join the waitlist instead',
        );
      }
    }

    const style = (rendition.styleParams || {}) as Record<string, unknown>;
    const fishLengthIn =
      dto.fishLengthIn ??
      (typeof style.fish_length_in === 'number' ? style.fish_length_in : null);
    const quote = priceQuote(dto.productType, fishLengthIn);
    const giftNote = dto.giftNote?.trim() || undefined;

    const affiliate = await this.affiliates.findActiveByCode(dto.affiliateCode);
    const earnedCommission = affiliate
      ? commissionCents(quote.amountCents, affiliate.commissionBps)
      : 0;

    const order = await this.prisma.order.create({
      data: {
        sessionId: dto.sessionId,
        renditionId: rendition.id,
        productType: dto.productType,
        status: 'AWAITING_PAYMENT',
        amountCents: quote.totalCents,
        productAmountCents: quote.amountCents,
        shippingCents: quote.shippingCents,
        sku: quote.sku,
        skuLabel: quote.skuLabel,
        fishLengthIn: fishLengthIn ?? undefined,
        email: dto.email,
        giftNote,
        affiliateId: affiliate?.id,
        commissionCents: earnedCommission > 0 ? earnedCommission : undefined,
      },
    });

    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: quote.amountCents,
          product_data: {
            name: `${productLabel(dto.productType)} · ${quote.sku}`,
            description: [
              quote.skuLabel,
              fishLengthIn
                ? `Life-size gyotaku · ${fishLengthIn}" nose-to-tail`
                : 'Gyotaku plotter print',
            ]
              .filter(Boolean)
              .join(' · '),
          },
        },
      },
    ];

    if (quote.shippingCents > 0) {
      lineItems.push({
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: quote.shippingCents,
          product_data: {
            name: 'Domestic shipping (US/CA)',
            description: 'Flat-rate shipping within the United States and Canada',
          },
        },
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: dto.email,
      success_url: `${webOrigin}/?order=success&orderId=${order.id}`,
      cancel_url: `${webOrigin}/?order=cancel&orderId=${order.id}`,
      shipping_address_collection: {
        allowed_countries: ['US', 'CA'],
      },
      phone_number_collection: { enabled: true },
      metadata: {
        orderId: order.id,
        renditionId: rendition.id,
        productType: dto.productType,
        sessionId: dto.sessionId,
        sku: quote.sku,
        ...(giftNote ? { giftNote: giftNote.slice(0, 450) } : {}),
        ...(affiliate
          ? {
              affiliateId: affiliate.id,
              affiliateCode: affiliate.code,
              commissionCents: String(earnedCommission),
            }
          : {}),
      },
      line_items: lineItems,
    });

    await this.prisma.order.update({
      where: { id: order.id },
      data: { stripeCheckoutSession: session.id },
    });

    if (!session.url) {
      throw new ServiceUnavailableException('Stripe did not return a checkout URL');
    }

    return {
      orderId: order.id,
      checkoutUrl: session.url,
      amountCents: quote.totalCents,
      productAmountCents: quote.amountCents,
      shippingCents: quote.shippingCents,
      sku: quote.sku,
      currency: 'usd',
      productType: dto.productType,
      affiliateCode: affiliate?.code ?? null,
      commissionCents: earnedCommission > 0 ? earnedCommission : null,
    };
  }

  async getOrder(orderId: string, sessionId?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { rendition: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (sessionId && order.sessionId !== sessionId) {
      throw new BadRequestException('sessionId does not match order');
    }
    return this.toPublic(order);
  }

  async getArtifacts(orderId: string, sessionId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { rendition: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.sessionId !== sessionId) {
      throw new ForbiddenException('sessionId does not match order');
    }
    if (!PAID_STATUSES.includes(order.status)) {
      throw new ForbiddenException('Artifacts unlock after payment');
    }

    const previewCleanKey =
      order.rendition.previewCleanKey || order.rendition.previewKey;
    const previewCleanUrl = previewCleanKey
      ? await this.storage.presignGet(previewCleanKey, 3600)
      : null;
    const svgUrl = order.rendition.svgKey
      ? await this.storage.presignGet(order.rendition.svgKey, 3600)
      : null;

    return {
      orderId: order.id,
      productType: order.productType,
      status: order.status,
      editionNumber: order.editionNumber,
      editionSize: order.editionSize,
      previewCleanUrl,
      svgUrl,
      paperWidthMm: order.rendition.paperWidthMm,
      paperHeightMm: order.rendition.paperHeightMm,
      estPlotSeconds: order.rendition.estPlotSeconds,
      seed: order.rendition.seed,
      styleParams: order.rendition.styleParams,
      renditionId: order.renditionId,
    };
  }

  async handleStripeWebhook(rawBody: Buffer, signature: string) {
    const stripe = this.requireStripe();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException('STRIPE_WEBHOOK_SECRET is not set');
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (err) {
      throw new BadRequestException(
        `Stripe signature verification failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      await this.markPaidFromCheckout(session);
    }

    return { received: true };
  }

  private async markPaidFromCheckout(session: Stripe.Checkout.Session) {
    const orderId = session.metadata?.orderId;
    if (!orderId) return;

    const shippingDetails =
      session.collected_information?.shipping_details ?? null;
    const shipping = shippingDetails?.address;
    const name = shippingDetails?.name || session.customer_details?.name;

    const paid = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) return null;
      if (!['DRAFT', 'AWAITING_PAYMENT'].includes(order.status)) return null;

      let editionNumber: number | undefined;
      let editionSize: number | undefined;

      if (order.productType === 'PLOTTED_ORIGINAL' && order.editionNumber == null) {
        await tx.editionCounter.upsert({
          where: { id: 'plotted_original' },
          create: { id: 'plotted_original', next: 1, size: 25 },
          update: {},
        });
        const claimed = await tx.editionCounter.update({
          where: { id: 'plotted_original' },
          data: { next: { increment: 1 } },
        });
        editionNumber = claimed.next - 1;
        editionSize = claimed.size;
      }

      return tx.order.update({
        where: { id: orderId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          email:
            session.customer_details?.email ||
            session.customer_email ||
            undefined,
          stripePaymentIntent:
            typeof session.payment_intent === 'string'
              ? session.payment_intent
              : session.payment_intent?.id,
          shippingName: name || undefined,
          shippingLine1: shipping?.line1 || undefined,
          shippingLine2: shipping?.line2 || undefined,
          shippingCity: shipping?.city || undefined,
          shippingState: shipping?.state || undefined,
          shippingPostal: shipping?.postal_code || undefined,
          shippingCountry: shipping?.country || undefined,
          editionNumber,
          editionSize,
        },
        include: { rendition: { include: { upload: true } } },
      });
    });

    if (paid && isGicleeProduct(paid.productType)) {
      await this.enqueuePrintJob(paid.rendition);
    }
  }

  /** Queue 300 DPI print.png generation for POD / giclée handoff. */
  private async enqueuePrintJob(rendition: {
    id: string;
    printKey: string | null;
    seed: number;
    styleParams: unknown;
    upload: { id: string; s3Key: string; imageHash: string };
  }) {
    if (rendition.printKey) return;
    const payload: PrintJobPayload = {
      type: 'print',
      renditionId: rendition.id,
      uploadId: rendition.upload.id,
      s3Key: rendition.upload.s3Key,
      styleParams: (rendition.styleParams || {}) as Record<string, unknown>,
      seed: rendition.seed,
      imageHash: rendition.upload.imageHash,
    };
    await this.redis.lpush(PYTHON_JOB_QUEUE, JSON.stringify(payload));
  }

  async listFulfillment(status?: OrderStatus) {
    const where = status
      ? { status }
      : {
          status: {
            in: ['PAID', 'PLOTTING', 'PRINTING', 'PACKED'] as OrderStatus[],
          },
        };

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        rendition: true,
        affiliate: { select: { id: true, code: true, name: true } },
      },
      orderBy: { paidAt: 'asc' },
      take: 100,
    });

    const availability = await this.plottedAvailability();
    const items = await Promise.all(orders.map((o) => this.toOperator(o)));
    return { availability, orders: items };
  }

  async updateFulfillment(orderId: string, dto: UpdateFulfillmentDto) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('Order not found');

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: dto.status,
        trackingNumber: dto.trackingNumber,
        fulfillmentNote: dto.fulfillmentNote,
      },
      include: {
        rendition: true,
        affiliate: { select: { id: true, code: true, name: true } },
      },
    });
    return this.toOperator(updated);
  }

  /**
   * Buy a shipping label via EasyPost/Shippo, write tracking, mark SHIPPED.
   * Safe to call from PACKED (preferred) or PAID/PLOTTING/PRINTING.
   */
  async createLabel(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        rendition: true,
        affiliate: { select: { id: true, code: true, name: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (['CANCELLED', 'REFUNDED'].includes(order.status)) {
      throw new BadRequestException('Order is cancelled');
    }
    if (order.shippingLabelUrl && order.trackingNumber) {
      return this.toOperator(order);
    }

    try {
      const label = await purchaseShippingLabel({
        name: order.shippingName,
        line1: order.shippingLine1,
        line2: order.shippingLine2,
        city: order.shippingCity,
        state: order.shippingState,
        postal: order.shippingPostal,
        country: order.shippingCountry,
        email: order.email,
      });

      const updated = await this.prisma.order.update({
        where: { id: orderId },
        data: {
          trackingNumber: label.trackingNumber,
          shippingLabelUrl: label.labelUrl,
          shippingCarrier: label.carrier,
          shippingService: label.service,
          status: 'SHIPPED',
          fulfillmentNote:
            order.fulfillmentNote ||
            `Label via ${label.provider} (${label.carrier} ${label.service})`,
        },
        include: {
          rendition: true,
          affiliate: { select: { id: true, code: true, name: true } },
        },
      });
      return this.toOperator(updated);
    } catch (err) {
      if (err instanceof ShippingNotConfiguredError) {
        throw new ServiceUnavailableException(err.message);
      }
      if (err instanceof ShippingAddressError) {
        throw new BadRequestException(err.message);
      }
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Label purchase failed',
      );
    }
  }

  /** Re-queue print generation if a giclée is missing printKey. */
  async requestPrint(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        rendition: { include: { upload: true } },
        affiliate: { select: { id: true, code: true, name: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (!isGicleeProduct(order.productType)) {
      throw new BadRequestException('Print raster is only for giclée orders');
    }
    if (order.rendition.printKey) {
      return this.toOperator(order);
    }
    await this.enqueuePrintJob(order.rendition);
    return this.toOperator(order);
  }

  private async toPublic(order: {
    id: string;
    sessionId: string;
    renditionId: string;
    productType: ProductType;
    status: OrderStatus;
    amountCents: number;
    productAmountCents?: number | null;
    shippingCents?: number | null;
    sku?: string | null;
    skuLabel?: string | null;
    giftNote?: string | null;
    currency: string;
    fishLengthIn: number | null;
    editionNumber: number | null;
    editionSize: number | null;
    email: string | null;
    trackingNumber: string | null;
    paidAt: Date | null;
    createdAt: Date;
    rendition?: {
      previewKey: string | null;
      previewCleanKey?: string | null;
      estPlotSeconds: number | null;
      paperWidthMm: number | null;
      paperHeightMm: number | null;
      seed: number;
      styleParams: unknown;
      uploadId: string;
    };
  }) {
    const paid = PAID_STATUSES.includes(order.status);
    let previewUrl: string | null = null;
    if (order.rendition?.previewKey) {
      const key =
        paid && order.rendition.previewCleanKey
          ? order.rendition.previewCleanKey
          : order.rendition.previewKey;
      previewUrl = await this.storage.presignGet(key);
    }

    return {
      id: order.id,
      renditionId: order.renditionId,
      productType: order.productType,
      status: order.status,
      amountCents: order.amountCents,
      productAmountCents: order.productAmountCents ?? null,
      shippingCents: order.shippingCents ?? 0,
      sku: order.sku ?? null,
      skuLabel: order.skuLabel ?? null,
      giftNote: order.giftNote ?? null,
      currency: order.currency,
      fishLengthIn: order.fishLengthIn,
      editionNumber: order.editionNumber,
      editionSize: order.editionSize,
      email: order.email,
      trackingNumber: order.trackingNumber,
      paidAt: order.paidAt,
      createdAt: order.createdAt,
      previewUrl,
      estPlotSeconds: order.rendition?.estPlotSeconds ?? null,
      paperWidthMm: order.rendition?.paperWidthMm ?? null,
      paperHeightMm: order.rendition?.paperHeightMm ?? null,
      paid,
      reorder: order.rendition
        ? {
            renditionId: order.renditionId,
            uploadId: order.rendition.uploadId,
            seed: order.rendition.seed,
            styleParams: order.rendition.styleParams,
          }
        : null,
    };
  }

  private async toOperator(order: {
    id: string;
    sessionId: string;
    renditionId: string;
    productType: ProductType;
    status: OrderStatus;
    amountCents: number;
    productAmountCents?: number | null;
    shippingCents?: number | null;
    sku?: string | null;
    skuLabel?: string | null;
    giftNote?: string | null;
    currency: string;
    fishLengthIn: number | null;
    editionNumber: number | null;
    editionSize: number | null;
    email: string | null;
    affiliateId?: string | null;
    commissionCents?: number | null;
    commissionPaidAt?: Date | null;
    shippingName: string | null;
    shippingLine1: string | null;
    shippingLine2: string | null;
    shippingCity: string | null;
    shippingState: string | null;
    shippingPostal: string | null;
    shippingCountry: string | null;
    trackingNumber: string | null;
    shippingLabelUrl?: string | null;
    shippingCarrier?: string | null;
    shippingService?: string | null;
    fulfillmentNote: string | null;
    paidAt: Date | null;
    createdAt: Date;
    rendition: {
      id: string;
      svgKey: string | null;
      previewKey: string | null;
      previewCleanKey: string | null;
      printKey: string | null;
      estPlotSeconds: number | null;
      paperWidthMm: number | null;
      paperHeightMm: number | null;
      seed: number;
      styleParams: unknown;
    };
    affiliate?: {
      id: string;
      code: string;
      name: string;
    } | null;
  }) {
    const svgUrl = order.rendition.svgKey
      ? await this.storage.presignGet(order.rendition.svgKey, 3600 * 6)
      : null;
    const previewUrl = order.rendition.previewKey
      ? await this.storage.presignGet(order.rendition.previewKey)
      : null;
    const previewCleanUrl = order.rendition.previewCleanKey
      ? await this.storage.presignGet(order.rendition.previewCleanKey, 3600 * 6)
      : null;
    const printUrl = order.rendition.printKey
      ? await this.storage.presignGet(order.rendition.printKey, 3600 * 6)
      : null;

    return {
      id: order.id,
      productType: order.productType,
      status: order.status,
      amountCents: order.amountCents,
      productAmountCents: order.productAmountCents ?? null,
      shippingCents: order.shippingCents ?? 0,
      sku: order.sku ?? null,
      skuLabel: order.skuLabel ?? null,
      giftNote: order.giftNote ?? null,
      currency: order.currency,
      fishLengthIn: order.fishLengthIn,
      editionNumber: order.editionNumber,
      editionSize: order.editionSize,
      email: order.email,
      affiliate: order.affiliate
        ? {
            id: order.affiliate.id,
            code: order.affiliate.code,
            name: order.affiliate.name,
          }
        : null,
      commissionCents: order.commissionCents ?? null,
      commissionPaidAt: order.commissionPaidAt ?? null,
      shipping: {
        name: order.shippingName,
        line1: order.shippingLine1,
        line2: order.shippingLine2,
        city: order.shippingCity,
        state: order.shippingState,
        postal: order.shippingPostal,
        country: order.shippingCountry,
      },
      trackingNumber: order.trackingNumber,
      shippingLabelUrl: order.shippingLabelUrl ?? null,
      shippingCarrier: order.shippingCarrier ?? null,
      shippingService: order.shippingService ?? null,
      fulfillmentNote: order.fulfillmentNote,
      paidAt: order.paidAt,
      createdAt: order.createdAt,
      estPlotSeconds: order.rendition.estPlotSeconds,
      paperWidthMm: order.rendition.paperWidthMm,
      paperHeightMm: order.rendition.paperHeightMm,
      renditionId: order.rendition.id,
      seed: order.rendition.seed,
      styleParams: order.rendition.styleParams,
      svgUrl,
      previewUrl,
      previewCleanUrl,
      printUrl,
      hasPrint: Boolean(order.rendition.printKey),
    };
  }
}
