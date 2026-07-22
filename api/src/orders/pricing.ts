import { ProductType } from '@prisma/client';

export type LengthBand = 'S' | 'M' | 'L' | 'XL';

export type PriceQuote = {
  productType: ProductType;
  fishLengthIn: number;
  band: LengthBand;
  sku: string;
  skuLabel: string;
  /** Product price only (excludes shipping). */
  amountCents: number;
  shippingCents: number;
  /** Product + domestic shipping. */
  totalCents: number;
  label: string;
};

/** Length-band cutoffs (max inches, exclusive upper for next). Env-overridable. */
export function bandForLength(fishLengthIn: number | null | undefined): LengthBand {
  const length = fishLengthIn && fishLengthIn > 0 ? fishLengthIn : 18;
  const sMax = intEnv('PRICE_BAND_S_MAX_IN', 14);
  const mMax = intEnv('PRICE_BAND_M_MAX_IN', 20);
  const lMax = intEnv('PRICE_BAND_L_MAX_IN', 28);
  if (length < sMax) return 'S';
  if (length < mMax) return 'M';
  if (length < lMax) return 'L';
  return 'XL';
}

const DEFAULT_BAND_CENTS: Record<ProductType, Record<LengthBand, number>> = {
  PLOTTED_ORIGINAL: {
    S: 14_900, // $149
    M: 18_900, // $189
    L: 24_900, // $249
    XL: 29_900, // $299
  },
  GICLEE: {
    S: 5_900, // $59
    M: 7_900, // $79
    L: 9_900, // $99
    XL: 12_900, // $129
  },
  GICLEE_FRAMED: {
    S: 12_900, // $129
    M: 15_900, // $159
    L: 19_900, // $199
    XL: 24_900, // $249
  },
};

const SKU_PREFIX: Record<ProductType, string> = {
  PLOTTED_ORIGINAL: 'PLOT',
  GICLEE: 'GIC',
  GICLEE_FRAMED: 'GICF',
};

const BAND_LABEL: Record<LengthBand, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};

function bandPriceCents(productType: ProductType, band: LengthBand): number {
  const envKey = `PRICE_${SKU_PREFIX[productType]}_${band}_CENTS`;
  return intEnv(envKey, DEFAULT_BAND_CENTS[productType][band]);
}

/** Flat domestic shipping (US/CA) added as a Stripe line item. */
export function shippingDomesticCents(): number {
  return Math.max(0, intEnv('SHIPPING_DOMESTIC_CENTS', 1_400)); // $14
}

export function priceQuote(
  productType: ProductType,
  fishLengthIn: number | null | undefined,
): PriceQuote {
  const length = fishLengthIn && fishLengthIn > 0 ? fishLengthIn : 18;
  const band = bandForLength(length);
  const amountCents = bandPriceCents(productType, band);
  const shippingCents = shippingDomesticCents();
  const sku = `${SKU_PREFIX[productType]}-${band}`;
  const skuLabel = `${BAND_LABEL[band]} (${bandRangeLabel(band)})`;
  return {
    productType,
    fishLengthIn: length,
    band,
    sku,
    skuLabel,
    amountCents,
    shippingCents,
    totalCents: amountCents + shippingCents,
    label: productLabel(productType),
  };
}

/** @deprecated Prefer priceQuote — kept for callers that only need product cents. */
export function priceCents(
  productType: ProductType,
  fishLengthIn: number | null | undefined,
): number {
  return priceQuote(productType, fishLengthIn).amountCents;
}

export function productLabel(productType: ProductType): string {
  switch (productType) {
    case 'PLOTTED_ORIGINAL':
      return 'Gyotaku plotted original (AxiDraw, signed)';
    case 'GICLEE_FRAMED':
      return 'Gyotaku giclée print (framed)';
    default:
      return 'Gyotaku giclée print';
  }
}

export function isGicleeProduct(productType: ProductType): boolean {
  return productType === 'GICLEE' || productType === 'GICLEE_FRAMED';
}

function bandRangeLabel(band: LengthBand): string {
  const sMax = intEnv('PRICE_BAND_S_MAX_IN', 14);
  const mMax = intEnv('PRICE_BAND_M_MAX_IN', 20);
  const lMax = intEnv('PRICE_BAND_L_MAX_IN', 28);
  switch (band) {
    case 'S':
      return `under ${sMax}"`;
    case 'M':
      return `${sMax}–${mMax}"`;
    case 'L':
      return `${mMax}–${lMax}"`;
    case 'XL':
      return `${lMax}"+`;
  }
}

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}
