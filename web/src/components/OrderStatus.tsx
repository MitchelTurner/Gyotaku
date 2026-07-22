import { useEffect, useState } from 'react'
import {
  getOrder,
  getOrderArtifacts,
  type OrderArtifactsResponse,
  type OrderResponse,
  type ProductType,
  type ReorderRecipe,
} from '../lib/api'
import { formatPaperSize } from '../lib/format'
import { getSessionId } from '../lib/session'

type Props = {
  orderId: string
  kind: 'success' | 'cancel'
  onDone: () => void
  onReorder?: (recipe: ReorderRecipe, preferProduct?: ProductType) => void
}

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

export function OrderStatus({ orderId, kind, onDone, onReorder }: Props) {
  const [order, setOrder] = useState<OrderResponse | null>(null)
  const [artifacts, setArtifacts] = useState<OrderArtifactsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const sessionId = getSessionId()
        const o = await getOrder(orderId, sessionId)
        if (cancelled) return
        setOrder(o)
        if (o.paid) {
          try {
            const a = await getOrderArtifacts(orderId, sessionId)
            if (!cancelled) setArtifacts(a)
          } catch {
            /* webhook may still be catching up */
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load order')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [orderId])

  // Soft poll until paid unlock appears after Stripe redirect
  useEffect(() => {
    if (kind !== 'success' || !order || order.paid) return
    const sessionId = getSessionId()
    const id = window.setInterval(async () => {
      try {
        const o = await getOrder(orderId, sessionId)
        setOrder(o)
        if (o.paid) {
          const a = await getOrderArtifacts(orderId, sessionId)
          setArtifacts(a)
          window.clearInterval(id)
        }
      } catch {
        /* ignore */
      }
    }, 2500)
    return () => window.clearInterval(id)
  }, [kind, order, orderId])

  const editionLabel =
    order?.editionNumber != null && order.editionSize != null
      ? `${order.editionNumber}/${order.editionSize}`
      : null
  const paper = order
    ? formatPaperSize(order.paperWidthMm, order.paperHeightMm)
    : null
  const otherProduct: ProductType | null = order
    ? order.productType === 'PLOTTED_ORIGINAL'
      ? 'GICLEE'
      : 'PLOTTED_ORIGINAL'
    : null

  return (
    <section className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-6 py-12">
      <p className="font-display text-2xl text-ink">Gyotaku</p>
      <h1 className="mt-6 font-display text-4xl text-ink">
        {kind === 'success' ? 'Order received' : 'Checkout cancelled'}
      </h1>
      <p className="mt-3 text-sm text-ink/55">
        {kind === 'success'
          ? order?.paid
            ? 'Payment confirmed. Download your clean preview below — we’ll plot or print, then ship.'
            : 'Payment is processing. You’ll get a confirmation email from Stripe when it clears. We’ll plot or print, then ship.'
          : 'No charge was made. You can return to your preview and try again whenever you’re ready.'}
      </p>

      {error && <p className="mt-6 text-sm text-red-800/80">{error}</p>}

      {order && (
        <div className="mt-8 space-y-2 text-sm text-ink/70">
          <p>
            <span className="text-ink/40">Order</span> {order.id}
          </p>
          <p>
            <span className="text-ink/40">Type</span>{' '}
            {order.productType === 'PLOTTED_ORIGINAL' ? 'Plotted original' : 'Giclée'}
            {editionLabel ? ` · edition ${editionLabel}` : ''}
          </p>
          <p>
            <span className="text-ink/40">Status</span> {order.status}
          </p>
          <p>
            <span className="text-ink/40">Total</span> {money(order.amountCents)}
          </p>
          {paper && (
            <p>
              <span className="text-ink/40">Paper</span> {paper}
            </p>
          )}
        </div>
      )}

      {order?.paid && (artifacts?.previewCleanUrl || order.previewUrl) && (
        <div className="mt-8">
          <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-ink/40">
            Your print (unlocked)
          </p>
          <img
            src={artifacts?.previewCleanUrl || order.previewUrl || ''}
            alt="Unlocked gyotaku preview"
            className="w-full rounded-sm object-contain ring-1 ring-ink/5"
          />
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            {artifacts?.previewCleanUrl && (
              <a
                href={artifacts.previewCleanUrl}
                download={`gyotaku-${order.id}.png`}
                target="_blank"
                rel="noreferrer"
                className="flex-1 rounded-sm bg-ink px-4 py-3 text-center text-sm font-medium text-foam"
              >
                Download preview
              </a>
            )}
            {artifacts?.svgUrl && (
              <a
                href={artifacts.svgUrl}
                download={`gyotaku-${order.id}.svg`}
                target="_blank"
                rel="noreferrer"
                className="flex-1 rounded-sm bg-ink/5 px-4 py-3 text-center text-sm font-medium text-ink/80"
              >
                Download SVG
              </a>
            )}
          </div>
        </div>
      )}

      {kind === 'success' && order?.reorder && onReorder && otherProduct && (
        <button
          type="button"
          onClick={() => onReorder(order.reorder!, otherProduct)}
          className="mt-6 w-full rounded-sm border border-ink/15 px-5 py-3 text-sm text-ink/70 transition hover:border-ink/30 hover:text-ink"
        >
          Order again as{' '}
          {otherProduct === 'PLOTTED_ORIGINAL' ? 'plotted original' : 'giclée'}
        </button>
      )}

      <button
        type="button"
        onClick={onDone}
        className="mt-4 w-full rounded-sm bg-ink px-5 py-3.5 text-sm font-medium text-foam"
      >
        {kind === 'success' ? 'Back to Gyotaku' : 'Return to preview'}
      </button>
    </section>
  )
}
