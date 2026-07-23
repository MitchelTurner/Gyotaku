import { useEffect, useState } from 'react'
import {
  createCheckout,
  quoteOrder,
  type AffiliatePublic,
  type ProductType,
  type QuoteResponse,
  type RenditionResponse,
} from '../lib/api'
import { formatPaperSize } from '../lib/format'
import { getAffiliateCode, getSessionId } from '../lib/session'

type Props = {
  rendition: RenditionResponse
  fishLengthIn: number | null
  initialProductType?: ProductType
  affiliate?: AffiliatePublic | null
  onBack: () => void
  onStartOver: () => void
}

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

export function OrderStep({
  rendition,
  fishLengthIn,
  initialProductType,
  affiliate,
  onBack,
  onStartOver,
}: Props) {
  const [productType, setProductType] = useState<ProductType>(
    initialProductType === 'GICLEE_FRAMED' ? 'GICLEE_FRAMED' : 'GICLEE',
  )
  const [quotes, setQuotes] = useState<Partial<Record<ProductType, QuoteResponse>>>({})
  const [email, setEmail] = useState('')
  const [giftNote, setGiftNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [giclee, framedQuote] = await Promise.all([
          quoteOrder('GICLEE', fishLengthIn),
          quoteOrder('GICLEE_FRAMED', fishLengthIn),
        ])
        if (!cancelled) {
          setQuotes({
            GICLEE: giclee,
            GICLEE_FRAMED: framedQuote,
          })
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load prices')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fishLengthIn])

  const selected = quotes[productType]
  const gicleeQuote = quotes.GICLEE
  const framedQuote = quotes.GICLEE_FRAMED
  const payLabel = selected
    ? money(selected.totalCents ?? selected.amountCents + (selected.shippingCents ?? 0))
    : null

  async function handleCheckout() {
    setBusy(true)
    setError(null)
    try {
      const sessionId = getSessionId()
      const affiliateCode = getAffiliateCode() || undefined
      const res = await createCheckout({
        sessionId,
        renditionId: rendition.id,
        productType,
        fishLengthIn,
        email: email.trim() || undefined,
        affiliateCode,
        giftNote: giftNote.trim() || undefined,
      })
      window.location.href = res.checkoutUrl
    } catch (e) {
      setBusy(false)
      setError(e instanceof Error ? e.message : 'Checkout failed')
    }
  }

  const paper = formatPaperSize(rendition.paperWidthMm, rendition.paperHeightMm)

  return (
    <section className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-8">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-2xl text-ink">Gyotaku</p>
        <button
          type="button"
          onClick={onStartOver}
          className="text-xs uppercase tracking-[0.16em] text-ink/45 transition hover:text-ink"
        >
          New photo
        </button>
      </div>

      <div>
        <h1 className="font-display text-4xl text-ink sm:text-5xl">Order your print</h1>
        <p className="mt-3 max-w-xl text-sm text-ink/55">
          Archival fine-art print, or ready-to-hang framed. Sized from your catch
          length; ships US &amp; Canada.
          {fishLengthIn != null ? ` Life-size ${fishLengthIn}".` : ''}
        </p>
        {affiliate && (
          <p className="mt-2 text-sm text-sea-deep/80">
            Referred by {affiliate.name}
            {affiliate.boatName ? ` · ${affiliate.boatName}` : ''}
          </p>
        )}
      </div>

      {rendition.previewUrl && (
        <img
          src={rendition.previewUrl}
          alt="Selected gyotaku"
          className="max-h-56 w-full rounded-sm object-contain ring-1 ring-ink/5"
        />
      )}

      {paper && (
        <dl className="text-sm">
          <dt className="text-[11px] uppercase tracking-[0.18em] text-ink/40">
            Artwork size
          </dt>
          <dd className="mt-1 text-ink/80">{paper}</dd>
        </dl>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <ProductCard
          active={productType === 'GICLEE'}
          title="Fine art print"
          body="Archival pigment on fine-art paper, rolled and ready to frame. Best value."
          price={
            gicleeQuote
              ? `${money(gicleeQuote.amountCents)}${
                  gicleeQuote.skuLabel ? ` · ${gicleeQuote.skuLabel}` : ''
                }`
              : '…'
          }
          badge="Best deal"
          onClick={() => setProductType('GICLEE')}
        />
        <ProductCard
          active={productType === 'GICLEE_FRAMED'}
          title="Framed"
          body="Same archival print in a ready-to-hang frame. Gift-ready, no framing trip."
          price={
            framedQuote
              ? `${money(framedQuote.amountCents)}${
                  framedQuote.skuLabel ? ` · ${framedQuote.skuLabel}` : ''
                }`
              : '…'
          }
          onClick={() => setProductType('GICLEE_FRAMED')}
        />
      </div>

      {selected?.sku && (
        <p className="text-xs text-ink/40">
          SKU {selected.sku}
          {selected.skuLabel ? ` · ${selected.skuLabel}` : ''}
          {selected.shippingCents != null
            ? ` · +${money(selected.shippingCents)} shipping`
            : ''}
          {selected.totalCents != null ? ` · ${money(selected.totalCents)} total` : ''}
        </p>
      )}

      <label className="block">
        <span className="mb-2 block text-[11px] uppercase tracking-[0.18em] text-ink/40">
          Email (optional)
        </span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-sm border border-ink/15 bg-foam/60 px-3 py-2.5 text-sm text-ink outline-none focus:border-sea"
        />
      </label>

      <label className="block">
        <span className="mb-2 block text-[11px] uppercase tracking-[0.18em] text-ink/40">
          Gift note (optional)
        </span>
        <textarea
          value={giftNote}
          onChange={(e) => setGiftNote(e.target.value.slice(0, 200))}
          rows={2}
          maxLength={200}
          placeholder="Short note for gift packaging"
          className="w-full resize-none rounded-sm border border-ink/15 bg-foam/60 px-3 py-2.5 text-sm text-ink outline-none focus:border-sea"
        />
      </label>

      {error && <p className="text-sm text-red-800/80">{error}</p>}

      <button
        type="button"
        disabled={busy || !selected}
        onClick={handleCheckout}
        className="w-full rounded-sm bg-sea px-5 py-3.5 text-sm font-medium text-foam transition hover:bg-sea-deep disabled:opacity-50"
      >
        {busy
          ? 'Redirecting to Stripe…'
          : payLabel
            ? `Pay ${payLabel}`
            : 'Loading price…'}
      </button>

      <button
        type="button"
        onClick={onBack}
        className="text-xs uppercase tracking-[0.16em] text-ink/40 transition hover:text-ink"
      >
        Back to preview
      </button>
    </section>
  )
}

function ProductCard({
  active,
  title,
  body,
  price,
  badge,
  onClick,
}: {
  active: boolean
  title: string
  body: string
  price: string
  badge?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'relative rounded-sm border border-ink bg-ink px-4 py-5 text-left text-foam'
          : 'relative rounded-sm border border-ink/10 bg-foam/40 px-4 py-5 text-left text-ink transition hover:border-ink/25'
      }
    >
      {badge && (
        <span
          className={
            active
              ? 'mb-2 inline-block text-[10px] uppercase tracking-[0.16em] text-foam/60'
              : 'mb-2 inline-block text-[10px] uppercase tracking-[0.16em] text-sea'
          }
        >
          {badge}
        </span>
      )}
      <p className="font-display text-2xl">{title}</p>
      <p className={`mt-2 text-xs leading-relaxed ${active ? 'text-foam/70' : 'text-ink/55'}`}>
        {body}
      </p>
      <p className="mt-4 text-sm font-medium">{price}</p>
    </button>
  )
}
