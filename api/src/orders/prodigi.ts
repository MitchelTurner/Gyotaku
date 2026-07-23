/**
 * Thin Prodigi Print API v4 client — no SDK.
 *
 * Env:
 *   PRODIGI_API_KEY          — required to enable
 *   PRODIGI_ENV              — sandbox | live (default: sandbox)
 *   PRODIGI_SHIPPING_METHOD  — Budget | Standard | … (default: Budget)
 *   PRODIGI_AUTO_SUBMIT      — true/false (default: true when key set)
 *   PUBLIC_API_URL           — for per-order callbackUrl
 */

export type ProdigiShippingMethod =
  | 'Budget'
  | 'Standard'
  | 'StandardPlus'
  | 'Express'
  | 'Overnight';

export type ProdigiRecipient = {
  name: string;
  email?: string | null;
  phoneNumber?: string | null;
  address: {
    line1: string;
    line2?: string | null;
    postalOrZipCode: string;
    countryCode: string;
    townOrCity: string;
    stateOrCounty?: string | null;
  };
};

export type ProdigiCreateOrderInput = {
  merchantReference: string;
  idempotencyKey: string;
  sku: string;
  assetUrl: string;
  recipient: ProdigiRecipient;
  shippingMethod?: ProdigiShippingMethod;
  callbackUrl?: string | null;
};

export type ProdigiOrderResult = {
  id: string;
  statusStage: string | null;
  raw: unknown;
};

export type ProdigiShipmentInfo = {
  trackingNumber: string | null;
  trackingUrl: string | null;
  carrier: string | null;
  status: string | null;
};

export class ProdigiNotConfiguredError extends Error {
  constructor() {
    super(
      'Prodigi is not configured. Set PRODIGI_API_KEY on the API service (see docs/FULFILLMENT.md).',
    );
  }
}

export class ProdigiApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

export function prodigiConfigured(): boolean {
  return Boolean((process.env.PRODIGI_API_KEY || '').trim());
}

/** Auto-submit after print.png is ready — on when key set unless explicitly disabled. */
export function prodigiAutoSubmitEnabled(): boolean {
  if (!prodigiConfigured()) return false;
  const raw = (process.env.PRODIGI_AUTO_SUBMIT || 'true').trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'no' || raw === 'off');
}

export function prodigiBaseUrl(): string {
  const env = (process.env.PRODIGI_ENV || 'sandbox').trim().toLowerCase();
  if (env === 'live' || env === 'production' || env === 'prod') {
    return 'https://api.prodigi.com/v4.0';
  }
  const override = (process.env.PRODIGI_API_BASE || '').trim().replace(/\/$/, '');
  if (override) return override;
  return 'https://api.sandbox.prodigi.com/v4.0';
}

export function prodigiShippingMethod(): ProdigiShippingMethod {
  const raw = (process.env.PRODIGI_SHIPPING_METHOD || 'Budget').trim();
  const allowed: ProdigiShippingMethod[] = [
    'Budget',
    'Standard',
    'StandardPlus',
    'Express',
    'Overnight',
  ];
  const match = allowed.find((m) => m.toLowerCase() === raw.toLowerCase());
  return match || 'Budget';
}

export function publicApiOrigin(): string {
  return (
    process.env.PUBLIC_API_URL ||
    process.env.API_PUBLIC_URL ||
    'https://gyotaku-api.up.railway.app'
  ).replace(/\/$/, '');
}

export function buildProdigiCallbackUrl(): string | null {
  const origin = publicApiOrigin();
  if (!origin) return null;
  return `${origin}/webhooks/prodigi`;
}

export async function createProdigiOrder(
  input: ProdigiCreateOrderInput,
): Promise<ProdigiOrderResult> {
  const key = (process.env.PRODIGI_API_KEY || '').trim();
  if (!key) throw new ProdigiNotConfiguredError();

  const body = {
    merchantReference: input.merchantReference.slice(0, 50),
    idempotencyKey: input.idempotencyKey.slice(0, 50),
    shippingMethod: input.shippingMethod || prodigiShippingMethod(),
    callbackUrl: input.callbackUrl || buildProdigiCallbackUrl() || undefined,
    recipient: {
      name: input.recipient.name,
      email: input.recipient.email || undefined,
      phoneNumber: input.recipient.phoneNumber || undefined,
      address: {
        line1: input.recipient.address.line1,
        line2: input.recipient.address.line2 || undefined,
        postalOrZipCode: input.recipient.address.postalOrZipCode,
        countryCode: input.recipient.address.countryCode,
        townOrCity: input.recipient.address.townOrCity,
        stateOrCounty: input.recipient.address.stateOrCounty || undefined,
      },
    },
    items: [
      {
        merchantReference: input.merchantReference.slice(0, 50),
        sku: input.sku,
        copies: 1,
        sizing: 'fillPrintArea',
        assets: [
          {
            printArea: 'default',
            url: input.assetUrl,
          },
        ],
      },
    ],
  };

  const res = await fetch(`${prodigiBaseUrl()}/Orders`, {
    method: 'POST',
    headers: {
      'X-API-Key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => null)) as
    | {
        outcome?: string;
        order?: { id?: string; status?: { stage?: string } };
        error?: { message?: string };
        message?: string;
      }
    | null;

  if (!res.ok) {
    const msg =
      json?.error?.message ||
      json?.message ||
      `Prodigi create order failed (${res.status})`;
    throw new ProdigiApiError(msg, res.status, json);
  }

  const id = json?.order?.id;
  if (!id) {
    throw new ProdigiApiError('Prodigi response missing order.id', res.status, json);
  }

  return {
    id,
    statusStage: json?.order?.status?.stage ?? null,
    raw: json,
  };
}

/** Pull first useful tracking payload from a Prodigi order object. */
export function extractProdigiShipment(order: unknown): ProdigiShipmentInfo {
  const empty: ProdigiShipmentInfo = {
    trackingNumber: null,
    trackingUrl: null,
    carrier: null,
    status: null,
  };
  if (!order || typeof order !== 'object') return empty;
  const shipments = (order as { shipments?: unknown }).shipments;
  if (!Array.isArray(shipments) || shipments.length === 0) return empty;

  for (const raw of shipments) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as {
      status?: string;
      tracking?: { number?: string; url?: string };
      carrier?: { name?: string; service?: string } | string;
    };
    const trackingNumber = s.tracking?.number || null;
    if (!trackingNumber && s.status !== 'Shipped') continue;
    const carrier =
      typeof s.carrier === 'string'
        ? s.carrier
        : s.carrier?.name || s.carrier?.service || null;
    return {
      trackingNumber,
      trackingUrl: s.tracking?.url || null,
      carrier,
      status: s.status || null,
    };
  }

  const first = shipments[0] as {
    status?: string;
    tracking?: { number?: string; url?: string };
    carrier?: { name?: string; service?: string } | string;
  };
  const carrier =
    typeof first.carrier === 'string'
      ? first.carrier
      : first.carrier?.name || first.carrier?.service || null;
  return {
    trackingNumber: first.tracking?.number || null,
    trackingUrl: first.tracking?.url || null,
    carrier,
    status: first.status || null,
  };
}

export function mapProdigiStageToOrderStatus(
  stage: string | null | undefined,
): 'PRINTING' | 'SHIPPED' | 'CANCELLED' | null {
  if (!stage) return null;
  const s = stage.toLowerCase();
  if (s === 'complete') return 'SHIPPED';
  if (s === 'cancelled') return 'CANCELLED';
  if (s === 'inprogress' || s === 'in_progress') return 'PRINTING';
  return null;
}
