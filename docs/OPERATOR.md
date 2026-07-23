# Operator guide

Open **`/operator`** on the web app and paste `OPERATOR_TOKEN` (from the API service env).

Tabs:

| Tab | Purpose |
|---|---|
| **Fulfillment** | Paid orders: plot / print / pack / ship |
| **Captains** | Affiliate QR codes + commission payouts |
| **Waitlist** | Emails waiting for plotted originals to reopen |
| **Failed jobs** | Dead-letter / failed renditions → retry |
| **Metrics** | Generate latency p50/p95, reject/fail rates |

---

## Fulfillment

Statuses roughly:

- **Plotted original:** `PAID` → `PLOTTING` → `PACKED` → `SHIPPED`
- **Giclée / framed:** `PAID` → `PRINTING` → `PACKED` → `SHIPPED`

Per order you can:

- Download **SVG** (plot path) or **300 DPI print** PNG
- **Queue 300 DPI** if a giclée is missing `printKey`
- **Buy label + ship** (EasyPost or Shippo when configured) — writes tracking and marks `SHIPPED`
- Advance status manually with the status chips

Orders show fish length, SKU, shipping address, gift note, and referring captain (if any).

### Plot queue auto-close

If outstanding plot time exceeds `PLOTTED_QUEUE_MAX_DAYS` (or the edition sells out), plotted originals close. Guests see a **waitlist** instead of checkout for that tier. Giclées stay available.

---

## Captains (affiliates)

See [AFFILIATES.md](AFFILIATES.md).

1. Add captain (name, optional boat / email / custom code, commission %).
2. Print or share the QR / referral URL.
3. When guests order via that code, commission accrues on paid orders.
4. **Mark commissions paid** after you send the captain their cut.

---

## Waitlist

When plotted originals are closed, guests can leave an email. This tab lists those entries so you can notify them when the queue reopens (manual outreach for now).

---

## Failed jobs & metrics

- **Failed jobs** — re-queue a rendition after a worker failure; dead-letter depth is shown.
- **Metrics** — last 24h generate times and reject/fail rates; useful after generator changes.

API also exposes deep `/health` checks and optional webhook alerts for queue depth (`ALERT_WEBHOOK_URL`).
