/** Default 10% of product amount (basis points). */
export function defaultCommissionBps(): number {
  return intEnv('AFFILIATE_DEFAULT_COMMISSION_BPS', 1000);
}

/** Commission owed to captain from product cents (shipping excluded). */
export function commissionCents(
  productAmountCents: number,
  commissionBps: number,
): number {
  if (productAmountCents <= 0 || commissionBps <= 0) return 0;
  return Math.round((productAmountCents * commissionBps) / 10_000);
}

/** Normalize captain referral codes: CAPT-MIKE → capt-mike */
export function normalizeAffiliateCode(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/** Build a URL-safe code from a name, with short suffix. */
export function suggestAffiliateCode(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  const suffix = Math.random().toString(36).slice(2, 6);
  return normalizeAffiliateCode(base ? `${base}-${suffix}` : `capt-${suffix}`);
}

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}
