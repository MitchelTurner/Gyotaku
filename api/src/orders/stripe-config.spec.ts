import {
  isFullyRefundedCharge,
  stripeAutomaticTaxEnabled,
} from './stripe-config';

describe('stripe-config', () => {
  const prev = process.env.STRIPE_AUTOMATIC_TAX;

  afterEach(() => {
    if (prev === undefined) delete process.env.STRIPE_AUTOMATIC_TAX;
    else process.env.STRIPE_AUTOMATIC_TAX = prev;
  });

  it('defaults automatic tax to off', () => {
    delete process.env.STRIPE_AUTOMATIC_TAX;
    expect(stripeAutomaticTaxEnabled()).toBe(false);
  });

  it('enables automatic tax for true-ish env values', () => {
    for (const v of ['true', 'TRUE', '1', 'yes', 'on']) {
      process.env.STRIPE_AUTOMATIC_TAX = v;
      expect(stripeAutomaticTaxEnabled()).toBe(true);
    }
  });

  it('ignores false-ish env values', () => {
    for (const v of ['false', '0', 'no', 'off', '']) {
      process.env.STRIPE_AUTOMATIC_TAX = v;
      expect(stripeAutomaticTaxEnabled()).toBe(false);
    }
  });

  it('detects fully refunded charges', () => {
    expect(
      isFullyRefundedCharge({
        refunded: true,
        amount_captured: 1000,
        amount_refunded: 1000,
      }),
    ).toBe(true);
    expect(
      isFullyRefundedCharge({
        refunded: false,
        amount_captured: 1000,
        amount_refunded: 1000,
      }),
    ).toBe(true);
    expect(
      isFullyRefundedCharge({
        refunded: false,
        amount_captured: 1000,
        amount_refunded: 200,
      }),
    ).toBe(false);
  });
});
