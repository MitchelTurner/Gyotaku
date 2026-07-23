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
  /** Suggested Prodigi catalog SKU for operator / future API submit. */
  fulfillmentSku: string | null;
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

/**
 * Retail prices sized for Prodigi fine-art POD (see docs/FULFILLMENT.md).
 * Rough COGS+ship targets: print ~$18–50, framed ~$55–130 → ~2–2.5× retail.
 */
const DEFAULT_BAND_CENTS: Record<ProductType, Record<LengthBand, number>> = {
  // Deprecated — not offered at checkout (kept for historical orders / env overrides)
  PLOTTED_ORIGINAL: {
    S: 14_900,
    M: 18_900,
    L: 24_900,
    XL: 29_900,
  },
  GICLEE: {
    S: 4_900, // $49
    M: 6_900, // $69
    L: 8_900, // $89
    XL: 11_900, // $119
  },
  GICLEE_FRAMED: {
    S: 9_900, // $99
    M: 13_900, // $139
    L: 17_900, // $179
    XL: 22_900, // $229
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

/**
 * Prodigi catalog hints (Hahnemühle German Etching + classic frame).
 * Confirm live SKUs in the Prodigi dashboard before API submit — frame
 * colour/mount variants change the suffix.
 */
const PRODIGI_PRINT_SKU: Record<LengthBand, string> = {
  S: 'GLOBAL-HGE-12X16',
  M: 'GLOBAL-HGE-16X20',
  L: 'GLOBAL-HGE-18X24',
  XL: 'GLOBAL-HGE-24X36',
};

const PRODIGI_FRAMED_SKU: Record<LengthBand, string> = {
  S: 'GLOBAL-CFB-12X16',
  M: 'GLOBAL-CFB-16X20',
  L: 'GLOBAL-CFB-18X24',
  XL: 'GLOBAL-CFB-24X36',
};

function bandPriceCents(productType: ProductType, band: LengthBand): number {
  const envKey = `PRICE_${SKU_PREFIX[productType]}_${band}_CENTS`;
  return intEnv(envKey, DEFAULT_BAND_CENTS[productType][band]);
}

/** Flat domestic shipping (US/CA) — framed is heavier/larger. */
export function shippingDomesticCents(productType?: ProductType): number {
  if (productType === 'GICLEE_FRAMED') {
    return Math.max(0, intEnv('SHIPPING_FRAMED_CENTS', 1_800)); // $18
  }
  if (productType === 'GICLEE') {
    return Math.max(0, intEnv('SHIPPING_PRINT_CENTS', 900)); // $9 rolled
  }
  // Legacy plotted / unspecified
  return Math.max(0, intEnv('SHIPPING_DOMESTIC_CENTS', 1_400));
}

export function fulfillmentSkuFor(
  productType: ProductType,
  band: LengthBand,
): string | null {
  if (productType === 'GICLEE') return PRODIGI_PRINT_SKU[band];
  if (productType === 'GICLEE_FRAMED') return PRODIGI_FRAMED_SKU[band];
  return null;
}

/** Plotted originals are retired from customer checkout. */
export function isPurchasableProduct(productType: ProductType): boolean {
  return productType === 'GICLEE' || productType === 'GICLEE_FRAMED';
}

export function priceQuote(
  productType: ProductType,
  fishLengthIn: number | null | undefined,
): PriceQuote {
  const length = fishLengthIn && fishLengthIn > 0 ? fishLengthIn : 18;
  const band = bandForLength(length);
  const amountCents = bandPriceCents(productType, band);
  const shippingCents = shippingDomesticCents(productType);
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
    fulfillmentSku: fulfillmentSkuFor(productType, band),
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
      return 'Gyotaku plotted original (retired)';
    case 'GICLEE_FRAMED':
      return 'Gyotaku archival print (framed, ready to hang)';
    default:
      return 'Gyotaku archival fine art print';
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
