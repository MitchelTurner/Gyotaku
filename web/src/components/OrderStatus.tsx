import { useEffect, useState } from 'react'
import { getOrder, type OrderResponse } from '../lib/api'
import { getSessionId } from '../lib/session'

type Props = {
  orderId: string
  kind: 'success' | 'cancel'
  onDone: () => void
}

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

export function OrderStatus({ orderId, kind, onDone }: Props) {
  const [order, setOrder] = useState<OrderResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const o = await getOrder(orderId, getSessionId())
        if (!cancelled) setOrder(o)
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

  return (
    <section className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-6 py-12">
      <p className="font-display text-2xl text-ink">Gyotaku</p>
      <h1 className="mt-6 font-display text-4xl text-ink">
        {kind === 'success' ? 'Order received' : 'Checkout cancelled'}
      </h1>
      <p className="mt-3 text-sm text-ink/55">
        {kind === 'success'
          ? 'Payment is processing. You’ll get a confirmation email from Stripe when it clears. We’ll plot or print, then ship.'
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
          </p>
          <p>
            <span className="text-ink/40">Status</span> {order.status}
          </p>
          <p>
            <span className="text-ink/40">Total</span> {money(order.amountCents)}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={onDone}
        className="mt-10 w-full rounded-sm bg-ink px-5 py-3.5 text-sm font-medium text-foam"
      >
        {kind === 'success' ? 'Back to Gyotaku' : 'Return to preview'}
      </button>
    </section>
  )
}
