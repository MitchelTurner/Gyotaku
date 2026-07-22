/**
 * Thin EasyPost / Shippo label purchase — no SDK required.
 * Set SHIPPING_PROVIDER=easypost|shippo and the matching API key.
 */

export type ShippingAddress = {
  name: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  state: string | null;
  postal: string | null;
  country: string | null;
  email?: string | null;
};

export type LabelResult = {
  trackingNumber: string;
  labelUrl: string;
  carrier: string;
  service: string;
  provider: 'easypost' | 'shippo';
};

export class ShippingNotConfiguredError extends Error {
  constructor() {
    super(
      'Shipping is not configured. Set SHIPPING_PROVIDER=easypost|shippo and EASYPOST_API_KEY or SHIPPO_API_KEY.',
    );
  }
}

export class ShippingAddressError extends Error {
  constructor(message: string) {
    super(message);
  }
}

function provider(): 'easypost' | 'shippo' | null {
  const raw = (process.env.SHIPPING_PROVIDER || '').trim().toLowerCase();
  if (raw === 'easypost' || raw === 'shippo') return raw;
  if (process.env.EASYPOST_API_KEY) return 'easypost';
  if (process.env.SHIPPO_API_KEY) return 'shippo';
  return null;
}

function fromAddress(): ShippingAddress {
  return {
    name: process.env.SHIP_FROM_NAME || 'Gyotaku',
    line1: process.env.SHIP_FROM_LINE1 || '',
    line2: process.env.SHIP_FROM_LINE2 || null,
    city: process.env.SHIP_FROM_CITY || '',
    state: process.env.SHIP_FROM_STATE || '',
    postal: process.env.SHIP_FROM_POSTAL || '',
    country: process.env.SHIP_FROM_COUNTRY || 'US',
    email: process.env.SHIP_FROM_EMAIL || null,
  };
}

function assertAddress(addr: ShippingAddress, label: string) {
  if (!addr.name || !addr.line1 || !addr.city || !addr.state || !addr.postal || !addr.country) {
    throw new ShippingAddressError(
      `${label} address is incomplete (need name, line1, city, state, postal, country)`,
    );
  }
}

export async function purchaseShippingLabel(
  to: ShippingAddress,
): Promise<LabelResult> {
  const p = provider();
  if (!p) throw new ShippingNotConfiguredError();
  assertAddress(to, 'Destination');
  const from = fromAddress();
  assertAddress(from, 'Origin (SHIP_FROM_*)');

  if (p === 'easypost') return purchaseEasyPost(from, to);
  return purchaseShippo(from, to);
}

async function purchaseEasyPost(
  from: ShippingAddress,
  to: ShippingAddress,
): Promise<LabelResult> {
  const key = process.env.EASYPOST_API_KEY;
  if (!key) throw new ShippingNotConfiguredError();

  const parcel = {
    length: Number(process.env.SHIP_PARCEL_LENGTH_IN || 24),
    width: Number(process.env.SHIP_PARCEL_WIDTH_IN || 4),
    height: Number(process.env.SHIP_PARCEL_HEIGHT_IN || 4),
    weight: Number(process.env.SHIP_PARCEL_WEIGHT_OZ || 16),
  };

  const body = {
    shipment: {
      to_address: {
        name: to.name,
        street1: to.line1,
        street2: to.line2 || undefined,
        city: to.city,
        state: to.state,
        zip: to.postal,
        country: to.country,
        email: to.email || undefined,
      },
      from_address: {
        name: from.name,
        street1: from.line1,
        street2: from.line2 || undefined,
        city: from.city,
        state: from.state,
        zip: from.postal,
        country: from.country,
        email: from.email || undefined,
      },
      parcel,
    },
  };

  const created = await fetchJson(
    'https://api.easypost.com/v2/shipments',
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );

  const rates: Array<{ id: string; rate: string; carrier: string; service: string }> =
    created.rates || [];
  if (!rates.length) {
    throw new Error('EasyPost returned no rates for this address');
  }
  rates.sort((a, b) => Number(a.rate) - Number(b.rate));
  const cheapest = rates[0];

  const bought = await fetchJson(
    `https://api.easypost.com/v2/shipments/${created.id}/buy`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ rate: { id: cheapest.id } }),
    },
  );

  const tracking = bought.tracking_code || bought.tracker?.tracking_code;
  const labelUrl =
    bought.postage_label?.label_url ||
    bought.postage_label?.label_pdf_url ||
    null;
  if (!tracking || !labelUrl) {
    throw new Error('EasyPost buy succeeded but missing tracking/label');
  }

  return {
    trackingNumber: String(tracking),
    labelUrl: String(labelUrl),
    carrier: String(bought.selected_rate?.carrier || cheapest.carrier),
    service: String(bought.selected_rate?.service || cheapest.service),
    provider: 'easypost',
  };
}

async function purchaseShippo(
  from: ShippingAddress,
  to: ShippingAddress,
): Promise<LabelResult> {
  const key = process.env.SHIPPO_API_KEY;
  if (!key) throw new ShippingNotConfiguredError();

  const shipment = await fetchJson('https://api.goshippo.com/shipments/', {
    method: 'POST',
    headers: {
      Authorization: `ShippoToken ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      address_from: {
        name: from.name,
        street1: from.line1,
        street2: from.line2 || undefined,
        city: from.city,
        state: from.state,
        zip: from.postal,
        country: from.country,
        email: from.email || undefined,
      },
      address_to: {
        name: to.name,
        street1: to.line1,
        street2: to.line2 || undefined,
        city: to.city,
        state: to.state,
        zip: to.postal,
        country: to.country,
        email: to.email || undefined,
      },
      parcels: [
        {
          length: String(process.env.SHIP_PARCEL_LENGTH_IN || 24),
          width: String(process.env.SHIP_PARCEL_WIDTH_IN || 4),
          height: String(process.env.SHIP_PARCEL_HEIGHT_IN || 4),
          distance_unit: 'in',
          weight: String(process.env.SHIP_PARCEL_WEIGHT_OZ || 16),
          mass_unit: 'oz',
        },
      ],
      async: false,
    }),
  });

  const rates: Array<{ object_id: string; amount: string; provider: string; servicelevel?: { name?: string } }> =
    shipment.rates || [];
  if (!rates.length) {
    throw new Error('Shippo returned no rates for this address');
  }
  rates.sort((a, b) => Number(a.amount) - Number(b.amount));
  const cheapest = rates[0];

  const tx = await fetchJson('https://api.goshippo.com/transactions/', {
    method: 'POST',
    headers: {
      Authorization: `ShippoToken ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      rate: cheapest.object_id,
      label_file_type: 'PDF',
      async: false,
    }),
  });

  if (tx.status && tx.status !== 'SUCCESS') {
    throw new Error(`Shippo label failed: ${tx.messages?.[0]?.text || tx.status}`);
  }

  const tracking = tx.tracking_number;
  const labelUrl = tx.label_url;
  if (!tracking || !labelUrl) {
    throw new Error('Shippo transaction missing tracking/label');
  }

  return {
    trackingNumber: String(tracking),
    labelUrl: String(labelUrl),
    carrier: String(cheapest.provider || 'unknown'),
    service: String(cheapest.servicelevel?.name || 'standard'),
    provider: 'shippo',
  };
}

async function fetchJson(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: any;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg =
      data?.error?.message ||
      data?.detail ||
      data?.messages?.[0]?.text ||
      text.slice(0, 200) ||
      res.statusText;
    throw new Error(`${url} → ${res.status}: ${msg}`);
  }
  return data;
}
