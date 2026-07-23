# Pricing

Checkout uses **length-band SKUs** plus a product-aware domestic shipping line item.

Hand-plotted originals are **not sold**. Live products: archival print and framed print (Prodigi-oriented). See [FULFILLMENT.md](FULFILLMENT.md).

## Length bands

| Band | Fish length (nose-to-tail) | SKU suffix | Typical print size |
|---|---|---|---|
| **S** | under 14" | `-S` | 12×16" |
| **M** | 14" – under 20" | `-M` | 16×20" |
| **L** | 20" – under 28" | `-L` | 18×24" |
| **XL** | 28"+ | `-XL` | 24×36" |

Cutoffs: `PRICE_BAND_S_MAX_IN`, `PRICE_BAND_M_MAX_IN`, `PRICE_BAND_L_MAX_IN`.

Missing length defaults to **18"** → band **M**.

## Product SKUs

| Product | SKU prefix | Default M price | Ship (US/CA) |
|---|---|---|---|
| Archival print | `GIC` | $69 | $9 |
| Framed print | `GICF` | $139 | $18 |
| ~~Plotted original~~ | `PLOT` | retired | — |

Full defaults:

| | S | M | L | XL |
|---|---|---|---|---|
| Print | $49 | $69 | $89 | $119 |
| Framed | $99 | $139 | $179 | $229 |

Override with `PRICE_GIC_{S,M,L,XL}_CENTS`, `PRICE_GICF_*_CENTS`.

Quote response includes `sku`, `skuLabel`, `band`, `amountCents` (product), `shippingCents`, `totalCents`, and `fulfillmentSku` (Prodigi hint).

## Shipping

- **Print (rolled):** `SHIPPING_PRINT_CENTS` (default **$9**)
- **Framed:** `SHIPPING_FRAMED_CENTS` (default **$18**)
- Legacy fallback: `SHIPPING_DOMESTIC_CENTS`
- Second Stripe Checkout line item: “Domestic shipping (US/CA)”
- Order stores `shippingCents`; charged total is product + shipping

## Upsells & extras

- **Framed** — second product card on the order screen (`GICLEE` ↔ `GICLEE_FRAMED`)
- **Gift note** — optional text on the order (stored on Order + Stripe metadata)
