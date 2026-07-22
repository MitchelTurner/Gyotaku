import { ProductType } from '@prisma/client';

/** USD cents. Tunable via env without code changes. */
export function priceCents(
  productType: ProductType,
  fishLengthIn: number | null | undefined,
): number {
  const length = fishLengthIn && fishLengthIn > 0 ? fishLengthIn : 18;

  if (productType === 'PLOTTED_ORIGINAL') {
    const base = intEnv('PRICE_PLOTTED_BASE_CENTS', 12_900); // $129
    const perInch = intEnv('PRICE_PLOTTED_PER_INCH_CENTS', 400); // $4/in
    const min = intEnv('PRICE_PLOTTED_MIN_CENTS', 14_900);
    return Math.max(min, base + Math.round(length * perInch));
  }

  const base = intEnv('PRICE_GICLEE_BASE_CENTS', 4_900); // $49
  const perInch = intEnv('PRICE_GICLEE_PER_INCH_CENTS', 150); // $1.50/in
  const min = intEnv('PRICE_GICLEE_MIN_CENTS', 5_900);
  return Math.max(min, base + Math.round(length * perInch));
}

export function productLabel(productType: ProductType): string {
  return productType === 'PLOTTED_ORIGINAL'
    ? 'Gyotaku plotted original (AxiDraw, signed)'
    : 'Gyotaku giclée print';
}

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}
