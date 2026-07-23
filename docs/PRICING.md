# Pricing

Checkout uses **length-band SKUs** (not a continuous per-inch formula), plus a flat domestic shipping line item.

## Length bands

| Band | Fish length (nose-to-tail) | SKU suffix |
|---|---|---|
| **S** | under 14" | `-S` |
| **M** | 14" – under 20" | `-M` |
| **L** | 20" – under 28" | `-L` |
| **XL** | 28"+ | `-XL` |

Cutoffs: `PRICE_BAND_S_MAX_IN`, `PRICE_BAND_M_MAX_IN`, `PRICE_BAND_L_MAX_IN`.

Missing length defaults to **18"** → band **M**.

## Product SKUs

| Product | SKU prefix | Default M price |
|---|---|---|
| Plotted original | `PLOT` | $189 |
| Giclée | `GIC` | $79 |
| Framed giclée | `GICF` | $159 |

Override any cell with env vars, e.g. `PRICE_PLOT_M_CENTS=18900`, `PRICE_GICF_XL_CENTS=24900`.

Quote response includes `sku`, `skuLabel`, `band`, `amountCents` (product), `shippingCents`, and `totalCents`.

## Shipping

- Flat **domestic** rate for US/CA: `SHIPPING_DOMESTIC_CENTS` (default **$14**)
- Added as a second Stripe Checkout line item: “Domestic shipping (US/CA)”
- Stored on the order as `shippingCents`; `amountCents` is the **total** charged

## Upsells & extras

- **Framed giclée** — checkbox on the order screen switches `GICLEE` → `GICLEE_FRAMED`
- **Gift note** — optional text on the order (stored on Order + Stripe metadata); shown in the operator queue

## Plotted availability

If the plot queue ETA exceeds `PLOTTED_QUEUE_MAX_DAYS`, or the edition is sold out, plotted originals are unavailable. Guests can join the **waitlist** instead of checking out that tier. Giclée / framed remain purchasable.
