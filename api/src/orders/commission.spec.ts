import { commissionCents, normalizeAffiliateCode } from './commission';

describe('commission', () => {
  it('computes basis-point share of product amount', () => {
    expect(commissionCents(18_900, 1000)).toBe(1_890); // 10%
    expect(commissionCents(10_000, 1500)).toBe(1_500); // 15%
    expect(commissionCents(0, 1000)).toBe(0);
  });

  it('normalizes referral codes', () => {
    expect(normalizeAffiliateCode('  Capt-Mike! ')).toBe('capt-mike');
  });
});
