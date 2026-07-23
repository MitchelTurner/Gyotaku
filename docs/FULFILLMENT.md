# Print & frame fulfillment

Hand-plotted AxiDraw originals are **retired**. Customer checkout is **archival print** or **framed print**, fulfilled via print-on-demand.

## Recommended partner: Prodigi

| | Prodigi | Gelato | Printful |
|---|---|---|---|
| Fine-art papers (Hahnemühle, etc.) | **Best** | Limited / poster grades | Photo papers |
| Framed, ready-to-hang | Strong (handmade frames) | Good (often unmounted pack) | Good |
| US/CA ship | Yes | Yes (local network) | Yes |
| API for custom store | Yes | Yes | Yes |
| Best for Gyotaku | **Primary** | Budget backup | Apparel-heavy |

**Why Prodigi:** gyotaku reads as fine art. Hahnemühle German Etching / Enhanced Matte + classic black frame matches the brand better than poster stock. Quote endpoint + white-label packing; no monthly fee required to start.

**When to use Gelato:** if you need the absolute lowest framed cost in the US and can accept museum/poster paper instead of Hahnemühle. Gelato+ (~$20/mo) unlocks better unit rates.

**Printful:** skip for wall art unless you already use them for merch — usually pricier on large frames.

## Size → Prodigi SKU hints

Mapped from fish length bands (confirm colour/mount variants in the Prodigi dashboard before going live):

| Band | Fish length | Print (rolled) | Framed (classic black hint) |
|---|---|---|---|
| S | under 14" | `GLOBAL-HGE-12X16` | `GLOBAL-CFB-12X16` |
| M | 14–20" | `GLOBAL-HGE-16X20` | `GLOBAL-CFB-16X20` |
| L | 20–28" | `GLOBAL-HGE-18X24` | `GLOBAL-CFB-18X24` |
| XL | 28"+ | `GLOBAL-HGE-24X36` | `GLOBAL-CFB-24X36` |

Also exposed on quotes as `fulfillmentSku` from `api/src/orders/pricing.ts`.

## Operator handoff (today)

1. Order paid → worker renders **300 DPI** `print.png`
2. Ops downloads print from the order row
3. Submit to Prodigi (dashboard or API) with the customer shipping address from Stripe
4. Mark order `PRINTING` → `PACKED` → `SHIPPED` (label via EasyPost/Shippo if you still ship yourself; or let Prodigi ship direct)

## Next automation (optional)

- `PRODIGI_API_KEY` → create order on `checkout.session.completed` for `GICLEE` / `GICLEE_FRAMED`
- Pass `print.png` URL as the print asset; map `fulfillmentSku` + Stripe shipping address
- Store Prodigi order id on `Order` for tracking sync

## Retail vs COGS (targets)

Defaults in `pricing.ts` aim for ~2–2.5× markup after print + partner shipping:

| SKU | Retail (product) | Domestic ship add-on |
|---|---|---|
| `GIC-M` | $69 | $9 |
| `GICF-M` | $139 | $18 |

Override with `PRICE_GIC_*_CENTS`, `PRICE_GICF_*_CENTS`, `SHIPPING_PRINT_CENTS`, `SHIPPING_FRAMED_CENTS`.
