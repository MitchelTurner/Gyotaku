# Captain affiliate program

Charter captains (or guides) get a unique referral code and QR. Guests scan it on the boat, order a fish print later, and the captain earns a cut of the **product** price (shipping excluded).

## Guest experience

1. Scan QR → lands on `https://<web>/?ref=<code>`
2. Code is stored in the browser; hero shows “With {Captain}”
3. Upload → preview → checkout (code sent as `affiliateCode`)
4. Paid order stores `affiliateId` + `commissionCents`

Invalid or inactive codes are ignored; checkout still works.

## Operator setup

1. Open **`/operator` → Captains**
2. **Add captain**
   - Name (required)
   - Boat name, email (optional)
   - Code (optional — auto-generated from name if blank)
   - Commission % (default **10%** = 1000 bps)
3. Print the QR image or copy the referral URL
4. After paid referrals pile up, **Mark commissions paid**

## Money

Commission = `round(productAmountCents × commissionBps / 10000)`.

- Default env: `AFFILIATE_DEFAULT_COMMISSION_BPS=1000`
- Per-captain override at create time (0–50%)
- Shipping and gift notes do not increase commission

Owed totals only count paid / in-fulfillment orders (not cancelled drafts).

## API

| Method | Route | Auth |
|---|---|---|
| `GET` | `/affiliates/:code` | Public — name + boat for UI |
| `GET` | `/operator/affiliates` | Operator — list + owed/paid |
| `POST` | `/operator/affiliates` | Operator — create |
| `POST` | `/operator/affiliates/:id/mark-paid` | Operator — settle unpaid commissions |
| `POST` | `/orders/checkout` | Body may include `affiliateCode` |

Stripe Checkout metadata also records `affiliateCode` / `commissionCents` when present.

## Tips for captains

- Laminate or sticker the QR on the cooler / tackle box
- Prefer a short memorable code (`capt-mike`) when creating the affiliate
- Guests can order later from home — the referral sticks in that browser until cleared
