import { priceCents } from './pricing';

describe('priceCents', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it('prices plotted originals with a floor', () => {
    delete process.env.PRICE_PLOTTED_BASE_CENTS;
    delete process.env.PRICE_PLOTTED_PER_INCH_CENTS;
    delete process.env.PRICE_PLOTTED_MIN_CENTS;
    expect(priceCents('PLOTTED_ORIGINAL', 18)).toBeGreaterThanOrEqual(14_900);
  });

  it('prices giclee below plotted for same length', () => {
    expect(priceCents('GICLEE', 18)).toBeLessThan(priceCents('PLOTTED_ORIGINAL', 18));
  });
});
