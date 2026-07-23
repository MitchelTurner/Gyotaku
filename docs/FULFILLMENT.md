# Print & frame fulfillment

Hand-plotted AxiDraw originals are **retired**. Customer checkout is **archival print** or **framed print**, fulfilled via **Prodigi** print-on-demand.

## Flow (automated)

1. Stripe Checkout paid → order `PAID` + shipping address saved
2. API queues a **300 DPI** `print.png` job (worker)
3. Worker uploads `print.png` → calls `POST /internal/print-ready`
4. API creates a Prodigi order (`print.png` URL + `fulfillmentSku` + address)
5. Order → `PRINTING`, stores `prodigiOrderId`
6. Prodigi callbacks `POST /webhooks/prodigi` → tracking + `SHIPPED` when complete

Manual fallback in `/operator`: **Submit to Prodigi** (or download PNG + dashboard).

## Env (API)

| Variable | Notes |
|---|---|
| `PRODIGI_API_KEY` | From Prodigi Integrations — **required** to enable |
| `PRODIGI_ENV` | `sandbox` (default) or `live` |
| `PRODIGI_AUTO_SUBMIT` | Default `true` when key set; set `false` to require operator button |
| `PRODIGI_SHIPPING_METHOD` | `Budget` (default), `Standard`, `StandardPlus`, `Express`, `Overnight` |
| `PUBLIC_API_URL` | e.g. `https://gyotaku-api.up.railway.app` — used for Prodigi `callbackUrl` |
| `INTERNAL_JOB_TOKEN` | Shared secret for worker → `/internal/print-ready` (falls back to `OPERATOR_TOKEN`) |

## Env (worker)

| Variable | Notes |
|---|---|
| `GYOTAKU_API_URL` | Same as API public URL |
| `INTERNAL_JOB_TOKEN` | Same value as API (or `OPERATOR_TOKEN`) |

## Prodigi Dashboard

1. Create sandbox + live API keys under Integrations
2. Start with `PRODIGI_ENV=sandbox` — no charge / no ship
3. Set merchant callback URL to `https://gyotaku-api.up.railway.app/webhooks/prodigi` (or rely on per-order `callbackUrl`)
4. Confirm SKUs below match your catalog (paper / frame variants)
5. Flip `PRODIGI_ENV=live` when ready

## Size → Prodigi SKU hints

Mapped from fish length bands (confirm colour/mount variants in the Prodigi dashboard before going live):

| Band | Fish length | Print (rolled) | Framed (classic black hint) |
|---|---|---|---|
| S | under 14" | `GLOBAL-HGE-12X16` | `GLOBAL-CFB-12X16` |
| M | 14–20" | `GLOBAL-HGE-16X20` | `GLOBAL-CFB-16X20` |
| L | 20–28" | `GLOBAL-HGE-18X24` | `GLOBAL-CFB-18X24` |
| XL | 28"+ | `GLOBAL-HGE-24X36` | `GLOBAL-CFB-24X36` |

Persisted on the order as `fulfillmentSku` at checkout (also from `api/src/orders/pricing.ts`).

## Why Prodigi

| | Prodigi | Gelato | Printful |
|---|---|---|---|
| Fine-art papers (Hahnemühle, etc.) | **Best** | Limited / poster grades | Photo papers |
| Framed, ready-to-hang | Strong (handmade frames) | Good (often unmounted pack) | Good |
| US/CA ship | Yes | Yes (local network) | Yes |
| API for custom store | Yes | Yes | Yes |
| Best for Gyotaku | **Primary** | Budget backup | Apparel-heavy |

## Retail vs COGS (targets)

Defaults in `pricing.ts` aim for ~2–2.5× markup after print + partner shipping:

| SKU | Retail (product) | Domestic ship add-on |
|---|---|---|
| `GIC-M` | $69 | $9 |
| `GICF-M` | $139 | $18 |

Override with `PRICE_GIC_*_CENTS`, `PRICE_GICF_*_CENTS`, `SHIPPING_PRINT_CENTS`, `SHIPPING_FRAMED_CENTS`.
