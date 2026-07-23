import { useCallback, useEffect, useState } from 'react'
import { formatPaperSize, formatPlotTime } from '../lib/format'
import {
  clearOperatorToken,
  createOperatorAffiliate,
  createOperatorLabel,
  getOperatorMetrics,
  getOperatorToken,
  listFailedRenditions,
  listOperatorAffiliates,
  listOperatorOrders,
  markAffiliatePaid,
  listOperatorWaitlist,
  patchOperatorOrder,
  requestOperatorPrint,
  retryRendition,
  setOperatorToken,
  type FailedRendition,
  type OperatorAffiliate,
  type OperatorMetrics,
  type OperatorOrder,
  type OperatorStatus,
  type PlottedAvailability,
  type WaitlistEntry,
} from '../lib/operatorApi'

type Tab = 'orders' | 'affiliates' | 'waitlist' | 'failed' | 'metrics'

const STATUS_FLOW: OperatorStatus[] = [
  'PAID',
  'PLOTTING',
  'PRINTING',
  'PACKED',
  'SHIPPED',
]

function money(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

function nextStatuses(order: OperatorOrder): OperatorStatus[] {
  if (order.productType === 'PLOTTED_ORIGINAL') {
    return ['PAID', 'PLOTTING', 'PACKED', 'SHIPPED', 'CANCELLED']
  }
  return ['PAID', 'PRINTING', 'PACKED', 'SHIPPED', 'CANCELLED']
}

function productTypeShort(t: OperatorOrder['productType']): string {
  switch (t) {
    case 'PLOTTED_ORIGINAL':
      return 'Plotted (legacy)'
    case 'GICLEE_FRAMED':
      return 'Framed'
    default:
      return 'Print'
  }
}

export function OperatorQueue() {
  const [tokenInput, setTokenInput] = useState(() => getOperatorToken())
  const [authed, setAuthed] = useState(() => Boolean(getOperatorToken()))
  const [tab, setTab] = useState<Tab>('orders')
  const [orders, setOrders] = useState<OperatorOrder[]>([])
  const [failed, setFailed] = useState<FailedRendition[]>([])
  const [deadLetterDepth, setDeadLetterDepth] = useState(0)
  const [metrics, setMetrics] = useState<OperatorMetrics | null>(null)
  const [affiliates, setAffiliates] = useState<OperatorAffiliate[]>([])
  const [totalOwedCents, setTotalOwedCents] = useState(0)
  const [newCaptain, setNewCaptain] = useState({
    name: '',
    boatName: '',
    email: '',
    code: '',
    commissionPercent: '10',
  })
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([])
  const [filter, setFilter] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      if (tab === 'orders') {
        const res = await listOperatorOrders(filter || undefined)
        setOrders(res.orders)
      } else if (tab === 'failed') {
        const res = await listFailedRenditions()
        setFailed(res.failed)
        setDeadLetterDepth(res.deadLetterDepth)
      } else if (tab === 'affiliates') {
        const res = await listOperatorAffiliates()
        setAffiliates(res.affiliates)
        setTotalOwedCents(res.totalOwedCents)
      } else if (tab === 'waitlist') {
        const res = await listOperatorWaitlist()
        setWaitlist(res.entries)
      } else {
        setMetrics(await getOperatorMetrics(24))
      }
      setAuthed(true)
    } catch (e) {
      setAuthed(false)
      setError(e instanceof Error ? e.message : 'Could not load queue')
    }
  }, [filter, tab])

  useEffect(() => {
    if (!getOperatorToken()) return
    void refresh()
    const id = window.setInterval(() => void refresh(), 20_000)
    return () => window.clearInterval(id)
  }, [refresh])

  function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setOperatorToken(tokenInput.trim())
    void refresh()
  }

  function handleLogout() {
    clearOperatorToken()
    setAuthed(false)
    setOrders([])
    setFailed([])
    setMetrics(null)
    setAffiliates([])
    setWaitlist([])
    setAvailability(null)
  }

  async function handleCreateAffiliate(e: React.FormEvent) {
    e.preventDefault()
    setBusyId('create-aff')
    setError(null)
    try {
      const pct = Number(newCaptain.commissionPercent)
      const commissionBps = Number.isFinite(pct)
        ? Math.round(pct * 100)
        : undefined
      await createOperatorAffiliate({
        name: newCaptain.name.trim(),
        boatName: newCaptain.boatName.trim() || undefined,
        email: newCaptain.email.trim() || undefined,
        code: newCaptain.code.trim() || undefined,
        commissionBps,
      })
      setNewCaptain({
        name: '',
        boatName: '',
        email: '',
        code: '',
        commissionPercent: '10',
      })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create captain')
    } finally {
      setBusyId(null)
    }
  }

  async function handleMarkPaid(id: string) {
    setBusyId(id)
    setError(null)
    try {
      await markAffiliatePaid(id)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark paid')
    } finally {
      setBusyId(null)
    }
  }

  async function handleRetry(id: string) {
    setBusyId(id)
    setError(null)
    try {
      await retryRendition(id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retry failed')
    } finally {
      setBusyId(null)
    }
  }

  async function setStatus(order: OperatorOrder, status: OperatorStatus) {
    setBusyId(order.id)
    setError(null)
    try {
      const updated = await patchOperatorOrder(order.id, { status })
      setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  async function buyLabel(order: OperatorOrder) {
    setBusyId(order.id)
    setError(null)
    try {
      const updated = await createOperatorLabel(order.id)
      setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Label failed')
    } finally {
      setBusyId(null)
    }
  }

  async function queuePrint(order: OperatorOrder) {
    setBusyId(order.id)
    setError(null)
    try {
      const updated = await requestOperatorPrint(order.id)
      setOrders((prev) => prev.map((o) => (o.id === order.id ? updated : o)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Print queue failed')
    } finally {
      setBusyId(null)
    }
  }

  if (!authed) {
    return (
      <section className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12">
        <p className="font-display text-2xl text-ink">Gyotaku</p>
        <h1 className="mt-4 font-display text-4xl text-ink">Operator</h1>
        <p className="mt-3 text-sm text-ink/55">
          Plot queue — enter the operator token from the API service.
        </p>
        <form onSubmit={handleLogin} className="mt-8 space-y-4">
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="OPERATOR_TOKEN"
            className="w-full rounded-sm border border-ink/15 bg-foam/60 px-3 py-2.5 text-sm outline-none focus:border-sea"
          />
          {error && <p className="text-sm text-red-800/80">{error}</p>}
          <button
            type="submit"
            className="w-full rounded-sm bg-ink px-5 py-3 text-sm font-medium text-foam"
          >
            Open queue
          </button>
        </form>
      </section>
    )
  }

  return (
    <section className="mx-auto min-h-dvh w-full max-w-5xl px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="font-display text-2xl text-ink">Gyotaku</p>
          <h1 className="mt-1 font-display text-4xl text-ink">Ops</h1>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="text-xs uppercase tracking-[0.16em] text-ink/45 hover:text-ink"
        >
          Sign out
        </button>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {(
          [
            ['orders', 'Fulfillment'],
            ['affiliates', 'Captains'],
            ['waitlist', 'Waitlist'],
            ['failed', 'Failed jobs'],
            ['metrics', 'Metrics'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={
              tab === id
                ? 'rounded-sm bg-ink px-3 py-1.5 text-xs font-medium text-foam'
                : 'rounded-sm bg-ink/5 px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-ink/10'
            }
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-sm bg-ink/5 px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-ink/10"
        >
          Refresh
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-800/80">{error}</p>}

      {tab === 'orders' && (
        <>
          <div className="mt-6 text-sm text-ink/65">
            <p>
              Checkout products:{' '}
              <span className="text-sea">fine art print</span> ·{' '}
              <span className="text-sea">framed</span>
              <span className="text-ink/40"> (plotted originals retired)</span>
            </p>
            <p className="mt-1 text-xs text-ink/40">
              Fulfill via Prodigi — see docs/FULFILLMENT.md · download 300 DPI print from each order
            </p>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            {['', ...STATUS_FLOW].map((s) => (
              <button
                key={s || 'active'}
                type="button"
                onClick={() => setFilter(s)}
                className={
                  filter === s
                    ? 'rounded-sm bg-ink px-3 py-1.5 text-xs font-medium text-foam'
                    : 'rounded-sm bg-ink/5 px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-ink/10'
                }
              >
                {s || 'Active'}
              </button>
            ))}
          </div>

          <ul className="mt-8 space-y-6">
            {orders.length === 0 && (
              <li className="text-sm text-ink/45">No orders in this view.</li>
            )}
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                busy={busyId === order.id}
                onStatus={(s) => void setStatus(order, s)}
                onLabel={() => void buyLabel(order)}
                onPrint={() => void queuePrint(order)}
              />
            ))}
          </ul>
        </>
      )}

      {tab === 'affiliates' && (
        <div className="mt-8 space-y-8">
          <p className="text-sm text-ink/55">
            Create a captain, print their QR, guests scan → order → captain earns
            a cut. Total owed: {money(totalOwedCents)}.
          </p>

          <form
            onSubmit={(e) => void handleCreateAffiliate(e)}
            className="grid gap-3 sm:grid-cols-2"
          >
            <input
              required
              value={newCaptain.name}
              onChange={(e) =>
                setNewCaptain((s) => ({ ...s, name: e.target.value }))
              }
              placeholder="Captain name"
              className="rounded-sm border border-ink/15 bg-foam/60 px-3 py-2 text-sm outline-none focus:border-sea"
            />
            <input
              value={newCaptain.boatName}
              onChange={(e) =>
                setNewCaptain((s) => ({ ...s, boatName: e.target.value }))
              }
              placeholder="Boat name (optional)"
              className="rounded-sm border border-ink/15 bg-foam/60 px-3 py-2 text-sm outline-none focus:border-sea"
            />
            <input
              type="email"
              value={newCaptain.email}
              onChange={(e) =>
                setNewCaptain((s) => ({ ...s, email: e.target.value }))
              }
              placeholder="Email (optional)"
              className="rounded-sm border border-ink/15 bg-foam/60 px-3 py-2 text-sm outline-none focus:border-sea"
            />
            <input
              value={newCaptain.code}
              onChange={(e) =>
                setNewCaptain((s) => ({ ...s, code: e.target.value }))
              }
              placeholder="Code (optional, e.g. capt-mike)"
              className="rounded-sm border border-ink/15 bg-foam/60 px-3 py-2 text-sm outline-none focus:border-sea"
            />
            <label className="flex items-center gap-2 text-sm text-ink/60">
              <span className="shrink-0">Commission %</span>
              <input
                value={newCaptain.commissionPercent}
                onChange={(e) =>
                  setNewCaptain((s) => ({
                    ...s,
                    commissionPercent: e.target.value,
                  }))
                }
                className="w-20 rounded-sm border border-ink/15 bg-foam/60 px-2 py-2 text-sm outline-none focus:border-sea"
              />
            </label>
            <button
              type="submit"
              disabled={busyId === 'create-aff' || !newCaptain.name.trim()}
              className="rounded-sm bg-ink px-4 py-2 text-sm font-medium text-foam disabled:opacity-50"
            >
              {busyId === 'create-aff' ? 'Creating…' : 'Add captain'}
            </button>
          </form>

          <ul className="space-y-8">
            {affiliates.length === 0 && (
              <li className="text-sm text-ink/45">No captains yet.</li>
            )}
            {affiliates.map((a) => (
              <li
                key={a.id}
                className="flex flex-col gap-4 border-t border-ink/10 pt-6 sm:flex-row"
              >
                <div className="shrink-0">
                  <img
                    src={a.qrImageUrl}
                    alt={`QR for ${a.code}`}
                    className="h-40 w-40 bg-foam object-contain ring-1 ring-ink/10"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-2xl text-ink">{a.name}</p>
                  <p className="mt-1 text-sm text-ink/60">
                    {[a.boatName, a.code, `${a.commissionPercent}%`]
                      .filter(Boolean)
                      .join(' · ')}
                    {!a.active ? ' · inactive' : ''}
                  </p>
                  <p className="mt-2 break-all font-mono text-xs text-ink/45">
                    {a.referralUrl}
                  </p>
                  <p className="mt-2 text-sm text-ink/70">
                    Owed {money(a.owedCents)} · paid {money(a.paidCents)} ·{' '}
                    {a.orderCount} orders
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a
                      href={a.referralUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-sm bg-ink/5 px-3 py-2 text-xs font-medium text-ink/80"
                    >
                      Open link
                    </a>
                    <button
                      type="button"
                      disabled={busyId === a.id || a.owedCents <= 0}
                      onClick={() => void handleMarkPaid(a.id)}
                      className="rounded-sm bg-sea px-3 py-2 text-xs font-medium text-foam hover:bg-sea-deep disabled:opacity-50"
                    >
                      {busyId === a.id ? 'Saving…' : 'Mark commissions paid'}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'waitlist' && (
        <div className="mt-8 space-y-4">
          <p className="text-sm text-ink/55">
            {waitlist.length} waiting for plotted originals to reopen.
          </p>
          {waitlist.length === 0 && (
            <p className="text-sm text-ink/45">Waitlist is empty.</p>
          )}
          {waitlist.map((e) => (
            <div key={e.id} className="border-t border-ink/10 pt-4">
              <p className="text-sm text-ink/80">{e.email}</p>
              <p className="mt-1 text-xs text-ink/40">
                {[
                  e.sku,
                  e.fishLengthIn != null ? `${e.fishLengthIn}"` : null,
                  new Date(e.createdAt).toLocaleString(),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {e.note && <p className="mt-1 text-xs text-ink/55">{e.note}</p>}
            </div>
          ))}
        </div>
      )}

      {tab === 'failed' && (
        <div className="mt-8 space-y-4">
          <p className="text-sm text-ink/55">
            Dead-letter depth: {deadLetterDepth}. Retry re-queues the generate job.
          </p>
          {failed.length === 0 && (
            <p className="text-sm text-ink/45">No failed renditions.</p>
          )}
          {failed.map((r) => (
            <div key={r.id} className="border-t border-ink/10 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusChip status={r.status} />
                <span className="font-mono text-xs text-ink/50">{r.id}</span>
              </div>
              <p className="mt-2 text-sm text-ink/70">
                {r.failureReason || 'Unknown failure'}
              </p>
              <p className="mt-1 text-xs text-ink/40">
                seed {r.seed}
                {r.completedAt
                  ? ` · ${new Date(r.completedAt).toLocaleString()}`
                  : ''}
              </p>
              <button
                type="button"
                disabled={busyId === r.id}
                onClick={() => void handleRetry(r.id)}
                className="mt-3 rounded-sm bg-sea px-3 py-2 text-xs font-medium text-foam hover:bg-sea-deep disabled:opacity-50"
              >
                {busyId === r.id ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          ))}
        </div>
      )}

      {tab === 'metrics' && metrics && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Metric
            label="Generate p50"
            value={fmtMs(metrics.generateMs.p50)}
          />
          <Metric
            label="Generate p95"
            value={fmtMs(metrics.generateMs.p95)}
          />
          <Metric
            label="Reject rate"
            value={fmtPct(metrics.outcomes.rejectRate)}
          />
          <Metric
            label="Fail rate"
            value={fmtPct(metrics.outcomes.failRate)}
          />
          <Metric label="Queue depth" value={String(metrics.queue.depth)} />
          <Metric
            label="Dead letter"
            value={String(metrics.queue.deadLetterDepth)}
          />
          <Metric
            label="Ready / Rejected / Failed"
            value={`${metrics.outcomes.ready} / ${metrics.outcomes.rejected} / ${metrics.outcomes.failed}`}
          />
          <Metric
            label="Worker sample p95"
            value={fmtMs(metrics.workerSampleMs.p95)}
          />
          <p className="sm:col-span-2 text-xs text-ink/40">
            Window last {metrics.windowHours}h · DB samples {metrics.sampleSize} ·
            worker samples {metrics.workerSampleMs.sampleSize}
          </p>
        </div>
      )}
    </section>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm bg-foam/50 px-4 py-3 ring-1 ring-ink/5">
      <p className="text-[11px] uppercase tracking-[0.16em] text-ink/40">{label}</p>
      <p className="mt-1 font-display text-2xl text-ink">{value}</p>
    </div>
  )
}

function fmtMs(ms: number | null): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

function fmtPct(rate: number | null): string {
  if (rate == null) return '—'
  return `${(rate * 100).toFixed(1)}%`
}

function OrderCard({
  order,
  busy,
  onStatus,
  onLabel,
  onPrint,
}: {
  order: OperatorOrder
  busy: boolean
  onStatus: (s: OperatorStatus) => void
  onLabel: () => void
  onPrint: () => void
}) {
  const paper = formatPaperSize(order.paperWidthMm, order.paperHeightMm)
  const plot = formatPlotTime(order.estPlotSeconds)
  const edition =
    order.editionNumber != null && order.editionSize != null
      ? `${order.editionNumber}/${order.editionSize}`
      : null
  const ship = [order.shipping.line1, order.shipping.city, order.shipping.state, order.shipping.postal]
    .filter(Boolean)
    .join(', ')

  return (
    <li className="border-t border-ink/10 pt-6">
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="w-full shrink-0 sm:w-36">
          {(order.previewCleanUrl || order.previewUrl) && (
            <img
              src={order.previewCleanUrl || order.previewUrl || ''}
              alt=""
              className="w-full rounded-sm object-contain ring-1 ring-ink/5"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={order.status} />
            <span className="text-xs text-ink/40">
              {productTypeShort(order.productType)}
              {order.sku ? ` · ${order.sku}` : ''}
              {edition ? ` · ${edition}` : ''}
            </span>
            <span className="text-xs text-ink/40">{money(order.amountCents)}</span>
          </div>
          <p className="mt-2 font-mono text-xs text-ink/50">{order.id}</p>
          <p className="mt-2 text-sm text-ink/70">
            {order.shipping.name || '—'}
            {ship ? ` · ${ship}` : ''}
          </p>
          <p className="mt-1 text-xs text-ink/40">
            {[
              order.email,
              order.affiliate
                ? `capt ${order.affiliate.name} (${order.affiliate.code})`
                : null,
              order.commissionCents
                ? `comm ${money(order.commissionCents)}${
                    order.commissionPaidAt ? ' paid' : ''
                  }`
                : null,
              order.fishLengthIn != null ? `${order.fishLengthIn}"` : null,
              paper ? `paper ${paper}` : null,
              plot,
              order.shippingCents ? `ship ${money(order.shippingCents)}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {order.giftNote && (
            <p className="mt-1 text-xs text-ink/55">Gift note: {order.giftNote}</p>
          )}
          {order.trackingNumber && (
            <p className="mt-1 text-xs text-ink/55">
              Tracking {order.trackingNumber}
              {order.shippingCarrier ? ` (${order.shippingCarrier})` : ''}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {order.svgUrl && (
              <a
                href={order.svgUrl}
                download={`gyotaku-${order.id}.svg`}
                target="_blank"
                rel="noreferrer"
                className="rounded-sm bg-sea px-3 py-2 text-xs font-medium text-foam hover:bg-sea-deep"
              >
                Download SVG
              </a>
            )}
            {order.printUrl && (
              <a
                href={order.printUrl}
                download={`gyotaku-${order.id}-print.png`}
                target="_blank"
                rel="noreferrer"
                className="rounded-sm bg-ink/5 px-3 py-2 text-xs font-medium text-ink/80"
              >
                Download print
              </a>
            )}
            {order.shippingLabelUrl && (
              <a
                href={order.shippingLabelUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-sm bg-ink/5 px-3 py-2 text-xs font-medium text-ink/80"
              >
                Label PDF
              </a>
            )}
            {(order.productType === 'GICLEE' ||
              order.productType === 'GICLEE_FRAMED') &&
              !order.hasPrint && (
              <button
                type="button"
                disabled={busy}
                onClick={onPrint}
                className="rounded-sm bg-ink/5 px-3 py-2 text-xs font-medium text-ink/80 disabled:opacity-50"
              >
                Queue 300 DPI
              </button>
            )}
            <button
              type="button"
              disabled={busy || Boolean(order.shippingLabelUrl)}
              onClick={onLabel}
              className="rounded-sm border border-ink/15 px-3 py-2 text-xs font-medium text-ink/70 disabled:opacity-50"
            >
              {order.shippingLabelUrl ? 'Label bought' : 'Buy label + ship'}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {nextStatuses(order).map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy || order.status === s}
                onClick={() => onStatus(s)}
                className={
                  order.status === s
                    ? 'rounded-sm bg-ink px-2.5 py-1 text-[11px] font-medium text-foam'
                    : 'rounded-sm bg-ink/5 px-2.5 py-1 text-[11px] font-medium text-ink/60 hover:bg-ink/10 disabled:opacity-40'
                }
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>
    </li>
  )
}

function StatusChip({ status }: { status: string }) {
  const tone =
    status === 'SHIPPED'
      ? 'bg-sea/15 text-sea-deep'
      : status === 'CANCELLED'
        ? 'bg-warn/15 text-warn'
        : 'bg-ink/10 text-ink/80'
  return (
    <span className={`rounded-sm px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide ${tone}`}>
      {status}
    </span>
  )
}
