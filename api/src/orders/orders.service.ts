import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OrderStatus, ProductType } from '@prisma/client';
import Stripe from 'stripe';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateCheckoutDto, UpdateFulfillmentDto } from './dto';
import { priceCents, productLabel } from './pricing';

const PAID_STATUSES: OrderStatus[] = [
  'PAID',
  'PLOTTING',
  'PRINTING',
  'PACKED',
  'SHIPPED',
];

@Injectable()
export class OrdersService {
  private readonly stripe: Stripe | null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    const key = process.env.STRIPE_SECRET_KEY;
    this.stripe = key ? new Stripe(key) : null;
  }

  private requireStripe(): Stripe {
    if (!this.stripe) {
      throw new ServiceUnavailableException(
        'Stripe is not configured. Set STRIPE_SECRET_KEY on the API service.',
      );
    }
    return this.stripe;
  }

  async quote(productType: ProductType, fishLengthIn?: number | null) {
    const amountCents = priceCents(productType, fishLengthIn);
    return {
      productType,
      fishLengthIn: fishLengthIn ?? null,
      amountCents,
      currency: 'usd',
      label: productLabel(productType),
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

    const style = (rendition.styleParams || {}) as Record<string, unknown>;
    const fishLengthIn =
      dto.fishLengthIn ??
      (typeof style.fish_length_in === 'number' ? style.fish_length_in : null);
    const amountCents = priceCents(dto.productType, fishLengthIn);

    const order = await this.prisma.order.create({
      data: {
        sessionId: dto.sessionId,
        renditionId: rendition.id,
        productType: dto.productType,
        status: 'AWAITING_PAYMENT',
        amountCents,
        fishLengthIn: fishLengthIn ?? undefined,
        email: dto.email,
      },
    });

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
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: amountCents,
            product_data: {
              name: productLabel(dto.productType),
              description: fishLengthIn
                ? `Life-size gyotaku · ${fishLengthIn}" nose-to-tail`
                : 'Gyotaku plotter print',
            },
          },
        },
      ],
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
      amountCents,
      currency: 'usd',
      productType: dto.productType,
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

  /**
   * Paid unlock: clean (unwatermarked) preview + SVG download.
   * Requires matching sessionId and a paid/fulfillment status.
   */
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

    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) return;
      if (!['DRAFT', 'AWAITING_PAYMENT'].includes(order.status)) return;

      let editionNumber: number | undefined;
      let editionSize: number | undefined;

      if (order.productType === 'PLOTTED_ORIGINAL' && order.editionNumber == null) {
        await tx.editionCounter.upsert({
          where: { id: 'plotted_original' },
          create: { id: 'plotted_original', next: 1, size: 25 },
          update: {},
        });
        // Atomic claim: RETURNING next is post-increment, so edition = next - 1
        const claimed = await tx.editionCounter.update({
          where: { id: 'plotted_original' },
          data: { next: { increment: 1 } },
        });
        editionNumber = claimed.next - 1;
        editionSize = claimed.size;
      }

      await tx.order.update({
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
      });
    });
  }

  /** Operator plot / fulfillment queue */
  async listFulfillment(status?: OrderStatus) {
    const where = status
      ? { status }
      : {
          status: {
            in: [
              'PAID',
              'PLOTTING',
              'PRINTING',
              'PACKED',
            ] as OrderStatus[],
          },
        };

    const orders = await this.prisma.order.findMany({
      where,
      include: { rendition: true },
      orderBy: { paidAt: 'asc' },
      take: 100,
    });

    return Promise.all(orders.map((o) => this.toOperator(o)));
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
      include: { rendition: true },
    });
    return this.toOperator(updated);
  }

  private async toPublic(order: {
    id: string;
    sessionId: string;
    renditionId: string;
    productType: ProductType;
    status: OrderStatus;
    amountCents: number;
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
      // Locked recipe so the buyer can reorder the same print (other product type)
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
    currency: string;
    fishLengthIn: number | null;
    editionNumber: number | null;
    editionSize: number | null;
    email: string | null;
    shippingName: string | null;
    shippingLine1: string | null;
    shippingLine2: string | null;
    shippingCity: string | null;
    shippingState: string | null;
    shippingPostal: string | null;
    shippingCountry: string | null;
    trackingNumber: string | null;
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
      currency: order.currency,
      fishLengthIn: order.fishLengthIn,
      editionNumber: order.editionNumber,
      editionSize: order.editionSize,
      email: order.email,
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
    };
  }
}
