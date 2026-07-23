import {
  bandForLength,
  fulfillmentSkuFor,
  isPurchasableProduct,
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

  it('returns print / framed SKUs with competitive defaults', () => {
    delete process.env.PRICE_GIC_M_CENTS;
    delete process.env.PRICE_GICF_M_CENTS;
    delete process.env.SHIPPING_PRINT_CENTS;
    delete process.env.SHIPPING_FRAMED_CENTS;

    const giclee = priceQuote('GICLEE', 18);
    expect(giclee.band).toBe('M');
    expect(giclee.sku).toBe('GIC-M');
    expect(giclee.amountCents).toBe(6_900);
    expect(giclee.shippingCents).toBe(900);
    expect(giclee.totalCents).toBe(7_800);
    expect(giclee.fulfillmentSku).toBe('GLOBAL-HGE-16X20');
    expect(giclee.skuLabel).toMatch(/Medium/i);

    const framed = priceQuote('GICLEE_FRAMED', 18);
    expect(framed.sku).toBe('GICF-M');
    expect(framed.amountCents).toBe(13_900);
    expect(framed.shippingCents).toBe(1_800);
    expect(framed.amountCents).toBeGreaterThan(giclee.amountCents);
    expect(framed.fulfillmentSku).toBe('GLOBAL-CFB-16X20');
  });

  it('marks only print products as purchasable', () => {
    expect(isPurchasableProduct('GICLEE')).toBe(true);
    expect(isPurchasableProduct('GICLEE_FRAMED')).toBe(true);
    expect(isPurchasableProduct('PLOTTED_ORIGINAL')).toBe(false);
  });

  it('honors env overrides for band prices and shipping', () => {
    process.env.PRICE_GIC_S_CENTS = '4500';
    process.env.SHIPPING_PRINT_CENTS = '700';
    expect(priceCents('GICLEE', 10)).toBe(4_500);
    expect(shippingDomesticCents('GICLEE')).toBe(700);
    expect(priceQuote('GICLEE', 10).totalCents).toBe(5_200);
  });

  it('prices XL above S for the same product', () => {
    expect(priceCents('GICLEE', 32)).toBeGreaterThan(priceCents('GICLEE', 10));
  });

  it('maps bands to Prodigi fulfillment SKUs', () => {
    expect(fulfillmentSkuFor('GICLEE', 'S')).toBe('GLOBAL-HGE-12X16');
    expect(fulfillmentSkuFor('GICLEE_FRAMED', 'L')).toBe('GLOBAL-CFB-18X24');
    expect(fulfillmentSkuFor('PLOTTED_ORIGINAL', 'M')).toBeNull();
  });
});
