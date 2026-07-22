import { useEffect, useState } from 'react'
import {
  createCheckout,
  joinWaitlist,
  quoteOrder,
  type ProductType,
  type QuoteResponse,
  type RenditionResponse,
} from '../lib/api'
import { formatPaperSize, formatPlotTime } from '../lib/format'
import { getSessionId } from '../lib/session'

type Props = {
  rendition: RenditionResponse
  fishLengthIn: number | null
  initialProductType?: ProductType
  onBack: () => void
  onStartOver: () => void
}

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

function productFamily(t: ProductType): 'plotted' | 'giclee' {
  return t === 'PLOTTED_ORIGINAL' ? 'plotted' : 'giclee'
}

export function OrderStep({
  rendition,
  fishLengthIn,
  initialProductType,
  onBack,
  onStartOver,
}: Props) {
  const initialFamily = productFamily(initialProductType ?? 'PLOTTED_ORIGINAL')
  const [family, setFamily] = useState<'plotted' | 'giclee'>(initialFamily)
  const [framed, setFramed] = useState(initialProductType === 'GICLEE_FRAMED')
  const [quotes, setQuotes] = useState<Partial<Record<ProductType, QuoteResponse>>>({})
  const [email, setEmail] = useState('')
  const [giftNote, setGiftNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [waitlistDone, setWaitlistDone] = useState<string | null>(null)

  const productType: ProductType =
    family === 'plotted' ? 'PLOTTED_ORIGINAL' : framed ? 'GICLEE_FRAMED' : 'GICLEE'

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [plotted, giclee, framedQuote] = await Promise.all([
          quoteOrder('PLOTTED_ORIGINAL', fishLengthIn),
          quoteOrder('GICLEE', fishLengthIn),
          quoteOrder('GICLEE_FRAMED', fishLengthIn),
        ])
        if (!cancelled) {
          setQuotes({
            PLOTTED_ORIGINAL: plotted,
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
  const plottedQuote = quotes.PLOTTED_ORIGINAL
  const gicleeQuote = quotes.GICLEE
  const framedQuote = quotes.GICLEE_FRAMED
  const waitlistMode =
    productType === 'PLOTTED_ORIGINAL' && plottedQuote?.waitlistOpen === true

  async function handleCheckout() {
    setBusy(true)
    setError(null)
    try {
      const sessionId = getSessionId()
      const res = await createCheckout({
        sessionId,
        renditionId: rendition.id,
        productType,
        fishLengthIn,
        email: email.trim() || undefined,
        giftNote: giftNote.trim() || undefined,
      })
      window.location.href = res.checkoutUrl
    } catch (e) {
      setBusy(false)
      setError(e instanceof Error ? e.message : 'Checkout failed')
    }
  }

  async function handleWaitlist() {
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Email is required for the waitlist')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await joinWaitlist({
        email: trimmed,
        sessionId: getSessionId(),
        renditionId: rendition.id,
        fishLengthIn,
        productType: 'PLOTTED_ORIGINAL',
      })
      setWaitlistDone(res.message)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join waitlist')
    } finally {
      setBusy(false)
    }
  }

  const paper = formatPaperSize(rendition.paperWidthMm, rendition.paperHeightMm)
  const plot = formatPlotTime(rendition.estPlotSeconds)
  const frameUpsell =
    framedQuote && gicleeQuote
      ? framedQuote.amountCents - gicleeQuote.amountCents
      : null
  const payLabel = selected
    ? money(selected.totalCents ?? selected.amountCents + (selected.shippingCents ?? 0))
    : null

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
          Length bands set a clear SKU price. Domestic shipping (US/CA) is a flat
          add-on at checkout.
          {fishLengthIn != null ? ` Life-size ${fishLengthIn}".` : ''}
        </p>
      </div>

      {rendition.previewUrl && (
        <img
          src={rendition.previewUrl}
          alt="Selected gyotaku"
          className="max-h-56 w-full rounded-sm object-contain ring-1 ring-ink/5"
        />
      )}

      {(paper || plot) && (
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          {paper && (
            <div>
              <dt className="text-[11px] uppercase tracking-[0.18em] text-ink/40">
                Paper size
              </dt>
              <dd className="mt-1 text-ink/80">{paper}</dd>
            </div>
          )}
          {plot && (
            <div>
              <dt className="text-[11px] uppercase tracking-[0.18em] text-ink/40">
                Est. plot time
              </dt>
              <dd className="mt-1 text-ink/80">{plot.replace(/^~/, '')}</dd>
            </div>
          )}
        </dl>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <ProductCard
          active={family === 'plotted'}
          title="Plotted original"
          body={
            plottedQuote?.waitlistOpen
              ? plottedQuote.unavailableReason ||
                'Plot queue is full — join the waitlist below.'
              : 'Drawn on an AxiDraw, signed and editioned (limited to 25). The physical ink path of your catch.'
          }
          price={
            plottedQuote
              ? `${money(plottedQuote.amountCents)}${
                  plottedQuote.skuLabel ? ` · ${plottedQuote.skuLabel}` : ''
                }`
              : '…'
          }
          onClick={() => setFamily('plotted')}
        />
        <ProductCard
          active={family === 'giclee'}
          title="Giclée"
          body="Archival pigment print of the artwork. Faster to fulfill, no hand plotting."
          price={
            gicleeQuote
              ? `${money(gicleeQuote.amountCents)}${
                  gicleeQuote.skuLabel ? ` · ${gicleeQuote.skuLabel}` : ''
                }`
              : '…'
          }
          onClick={() => setFamily('giclee')}
        />
      </div>

      {family === 'giclee' && framedQuote && (
        <label className="flex cursor-pointer items-start gap-3 text-sm text-ink/70">
          <input
            type="checkbox"
            checked={framed}
            onChange={(e) => setFramed(e.target.checked)}
            className="mt-1"
          />
          <span>
            <span className="font-medium text-ink">Add frame</span>
            {frameUpsell != null && frameUpsell > 0
              ? ` (+${money(frameUpsell)})`
              : ''}
            {' — '}
            ready-to-hang framed giclée
            {framedQuote.sku ? ` · ${framedQuote.sku}` : ''}
          </span>
        </label>
      )}

      {selected?.sku && (
        <p className="text-xs text-ink/40">
          SKU {selected.sku}
          {selected.skuLabel ? ` · ${selected.skuLabel}` : ''}
          {selected.shippingCents != null
            ? ` · +${money(selected.shippingCents)} domestic shipping`
            : ''}
        </p>
      )}

      {plottedQuote?.queueEtaDays != null &&
        plottedQuote.available !== false &&
        family === 'plotted' && (
          <p className="text-xs text-ink/40">
            Plot queue ~{plottedQuote.queueEtaDays} days
          </p>
        )}

      <label className="block">
        <span className="mb-2 block text-[11px] uppercase tracking-[0.18em] text-ink/40">
          Email {waitlistMode ? '(required)' : '(optional)'}
        </span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-sm border border-ink/15 bg-foam/60 px-3 py-2.5 text-sm text-ink outline-none focus:border-sea"
        />
      </label>

      {!waitlistMode && (
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
      )}

      {error && <p className="text-sm text-red-800/80">{error}</p>}
      {waitlistDone && <p className="text-sm text-sea">{waitlistDone}</p>}

      {waitlistMode ? (
        <button
          type="button"
          disabled={busy || Boolean(waitlistDone)}
          onClick={handleWaitlist}
          className="w-full rounded-sm bg-sea px-5 py-3.5 text-sm font-medium text-foam transition hover:bg-sea-deep disabled:opacity-50"
        >
          {busy ? 'Joining…' : waitlistDone ? 'On the waitlist' : 'Join waitlist'}
        </button>
      ) : (
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
      )}

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
  onClick,
}: {
  active: boolean
  title: string
  body: string
  price: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-sm border border-ink bg-ink px-4 py-5 text-left text-foam'
          : 'rounded-sm border border-ink/10 bg-foam/40 px-4 py-5 text-left text-ink transition hover:border-ink/25'
      }
    >
      <p className="font-display text-2xl">{title}</p>
      <p className={`mt-2 text-xs leading-relaxed ${active ? 'text-foam/70' : 'text-ink/55'}`}>
        {body}
      </p>
      <p className="mt-4 text-sm font-medium">{price}</p>
    </button>
  )
}
