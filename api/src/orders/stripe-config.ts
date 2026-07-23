/**
 * Stripe Checkout / Tax toggles.
 *
 * Automatic tax requires Stripe Tax enabled in the Dashboard (and usually
 * a billing address). Keep it off until Tax is configured, then set
 * STRIPE_AUTOMATIC_TAX=true on the API service.
 */
export function stripeAutomaticTaxEnabled(): boolean {
  const raw = (process.env.STRIPE_AUTOMATIC_TAX || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/** True when a Charge should flip the order to REFUNDED. */
export function isFullyRefundedCharge(charge: {
  refunded: boolean;
  amount_captured: number;
  amount_refunded: number;
}): boolean {
  return (
    charge.refunded ||
    (charge.amount_captured > 0 &&
      charge.amount_refunded >= charge.amount_captured)
  );
}
