import { useEffect, useState } from 'react'
import {
  createCheckout,
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

export function OrderStep({
  rendition,
  fishLengthIn,
  initialProductType,
  onBack,
  onStartOver,
}: Props) {
  const [productType, setProductType] = useState<ProductType>(
    initialProductType ?? 'PLOTTED_ORIGINAL',
  )
  const [quotes, setQuotes] = useState<Record<ProductType, QuoteResponse | null>>({
    PLOTTED_ORIGINAL: null,
    GICLEE: null,
  })
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [plotted, giclee] = await Promise.all([
          quoteOrder('PLOTTED_ORIGINAL', fishLengthIn),
          quoteOrder('GICLEE', fishLengthIn),
        ])
        if (!cancelled) {
          setQuotes({ PLOTTED_ORIGINAL: plotted, GICLEE: giclee })
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
      })
      window.location.href = res.checkoutUrl
    } catch (e) {
      setBusy(false)
      setError(e instanceof Error ? e.message : 'Checkout failed')
    }
  }

  const selected = quotes[productType]
  const paper = formatPaperSize(rendition.paperWidthMm, rendition.paperHeightMm)
  const plot = formatPlotTime(rendition.estPlotSeconds)

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
          Choose a hand-plotted original or a giclée. Checkout collects shipping
          through Stripe — no account required.
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
          active={productType === 'PLOTTED_ORIGINAL'}
          title="Plotted original"
          body="Drawn on an AxiDraw, signed and editioned (limited to 25). The physical ink path of your catch."
          price={quotes.PLOTTED_ORIGINAL ? money(quotes.PLOTTED_ORIGINAL.amountCents) : '…'}
          onClick={() => setProductType('PLOTTED_ORIGINAL')}
        />
        <ProductCard
          active={productType === 'GICLEE'}
          title="Giclée"
          body="Archival pigment print of the artwork. Faster to fulfill, no hand plotting."
          price={quotes.GICLEE ? money(quotes.GICLEE.amountCents) : '…'}
          onClick={() => setProductType('GICLEE')}
        />
      </div>

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

      {error && <p className="text-sm text-red-800/80">{error}</p>}

      <button
        type="button"
        disabled={busy || !selected}
        onClick={handleCheckout}
        className="w-full rounded-sm bg-sea px-5 py-3.5 text-sm font-medium text-foam transition hover:bg-sea-deep disabled:opacity-50"
      >
        {busy
          ? 'Redirecting to Stripe…'
          : selected
            ? `Pay ${money(selected.amountCents)}`
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
