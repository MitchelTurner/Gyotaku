import {
  bandForLength,
  priceCents,
  priceQuote,
  shippingDomesticCents,
} from './pricing';

describe('length-band pricing', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it('maps lengths to S/M/L/XL bands', () => {
    delete process.env.PRICE_BAND_S_MAX_IN;
    delete process.env.PRICE_BAND_M_MAX_IN;
    delete process.env.PRICE_BAND_L_MAX_IN;
    expect(bandForLength(10)).toBe('S');
    expect(bandForLength(14)).toBe('M');
    expect(bandForLength(18)).toBe('M');
    expect(bandForLength(20)).toBe('L');
    expect(bandForLength(27)).toBe('L');
    expect(bandForLength(28)).toBe('XL');
    expect(bandForLength(null)).toBe('M'); // default 18"
  });

  it('returns displayable SKUs and fixed band prices', () => {
    delete process.env.PRICE_PLOT_M_CENTS;
    delete process.env.PRICE_GIC_M_CENTS;
    delete process.env.PRICE_GICF_M_CENTS;
    delete process.env.SHIPPING_DOMESTIC_CENTS;

    const plotted = priceQuote('PLOTTED_ORIGINAL', 18);
    expect(plotted.band).toBe('M');
    expect(plotted.sku).toBe('PLOT-M');
    expect(plotted.amountCents).toBe(18_900);
    expect(plotted.shippingCents).toBe(1_400);
    expect(plotted.totalCents).toBe(20_300);
    expect(plotted.skuLabel).toMatch(/Medium/i);

    const giclee = priceQuote('GICLEE', 18);
    expect(giclee.sku).toBe('GIC-M');
    expect(giclee.amountCents).toBe(7_900);
    expect(giclee.amountCents).toBeLessThan(plotted.amountCents);

    const framed = priceQuote('GICLEE_FRAMED', 18);
    expect(framed.sku).toBe('GICF-M');
    expect(framed.amountCents).toBeGreaterThan(giclee.amountCents);
  });

  it('honors env overrides for band prices and shipping', () => {
    process.env.PRICE_PLOT_S_CENTS = '11100';
    process.env.SHIPPING_DOMESTIC_CENTS = '900';
    expect(priceCents('PLOTTED_ORIGINAL', 10)).toBe(11_100);
    expect(shippingDomesticCents()).toBe(900);
    expect(priceQuote('PLOTTED_ORIGINAL', 10).totalCents).toBe(12_000);
  });

  it('prices XL above S for the same product', () => {
    expect(priceCents('GICLEE', 32)).toBeGreaterThan(priceCents('GICLEE', 10));
  });
});
