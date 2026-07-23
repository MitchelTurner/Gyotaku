# Operator guide

Open **`/operator`** on the web app and paste `OPERATOR_TOKEN` (from the API service env).

Tabs:

| Tab | Purpose |
|---|---|
| **Fulfillment** | Paid orders: print / pack / ship |
| **Captains** | Affiliate QR codes + commission payouts |
| **Waitlist** | Legacy emails (plotted originals retired) |
| **Failed jobs** | Dead-letter / failed renditions → retry |
| **Metrics** | Generate latency p50/p95, reject/fail rates |

---

## Fulfillment

Customer checkout is **fine art print** or **framed print** only. See [FULFILLMENT.md](FULFILLMENT.md) for Prodigi.

Statuses:

- **Print / framed:** `PAID` → `PRINTING` → `PACKED` → `SHIPPED`
- Legacy plotted orders (if any): `PAID` → `PLOTTING` → `PACKED` → `SHIPPED`

Per order you can:

- Download **300 DPI print** PNG (and SVG if present)
- **Queue 300 DPI** if missing `printKey`
- Submit the PNG to **Prodigi** using the quote’s `fulfillmentSku` hint + Stripe shipping address
- **Buy label + ship** (EasyPost or Shippo) if you ship yourself — or let Prodigi ship direct
- Advance status with the status chips

Orders show fish length, SKU, shipping address, gift note, and referring captain (if any).

---

## Captains (affiliates)

See [AFFILIATES.md](AFFILIATES.md).

1. Add captain (name, optional boat / email / custom code, commission %).
2. Print or share the QR / referral URL.
3. When guests order via that code, commission accrues on paid orders.
4. **Mark commissions paid** after you send the captain their cut.

---

## Metrics

Generate-time percentiles and reject rates help catch model or corpus regressions after worker deploys.
