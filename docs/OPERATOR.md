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
- **Submit to Prodigi** if auto-submit missed (needs `PRODIGI_API_KEY` on API)
- **Buy label + ship** (EasyPost/Shippo) only when *not* using Prodigi
- Advance status with the status chips

Paid print/framed orders normally auto-submit once `print.png` is ready. Rows show `prodigiOrderId` + stage; Prodigi callbacks set tracking and `SHIPPED`.

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
