import type { RenditionResponse } from '../lib/api'
import { formatPlotTime } from '../lib/format'

export type StrategyName = 'flowfield' | 'contour' | 'stipple'

const LABELS: Record<StrategyName, string> = {
  flowfield: 'Flow',
  contour: 'Contour',
  stipple: 'Stipple',
}

type Slot = {
  strategy: StrategyName
  rendition: RenditionResponse | null
  error: string | null
}

type Props = {
  slots: Slot[]
  selectedId: string | null
  busy: boolean
  onSelect: (rendition: RenditionResponse, strategy: StrategyName) => void
  onClose: () => void
}

export function CompareStrategies({
  slots,
  selectedId,
  busy,
  onSelect,
  onClose,
}: Props) {
  return (
    <section className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-8">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-display text-2xl text-ink">Gyotaku</p>
        <button
          type="button"
          onClick={onClose}
          className="text-xs uppercase tracking-[0.16em] text-ink/45 transition hover:text-ink"
        >
          Back
        </button>
      </div>

      <div>
        <h1 className="font-display text-4xl text-ink sm:text-5xl">Compare styles</h1>
        <p className="mt-3 max-w-xl text-sm text-ink/55">
          Same photo and seed, three mark strategies. Pick one before you order.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-3">
        {slots.map((slot) => {
          const r = slot.rendition
          const active = r != null && r.id === selectedId
          const plot = r ? formatPlotTime(r.estPlotSeconds) : null
          return (
            <button
              key={slot.strategy}
              type="button"
              disabled={!r || r.status !== 'READY' || busy}
              onClick={() => r && onSelect(r, slot.strategy)}
              className={
                active
                  ? 'rounded-sm border border-ink bg-foam/80 p-3 text-left'
                  : 'rounded-sm border border-ink/10 bg-foam/40 p-3 text-left transition hover:border-ink/25 disabled:opacity-60'
              }
            >
              <p className="font-display text-2xl text-ink">{LABELS[slot.strategy]}</p>
              <div className="mt-3 aspect-[3/4] overflow-hidden bg-[linear-gradient(160deg,#f7f9f7,#e4ebe6)]">
                {r?.previewUrl ? (
                  <img
                    src={r.previewUrl}
                    alt={`${LABELS[slot.strategy]} preview`}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-ink/40">
                    {slot.error
                      ? slot.error
                      : busy || !r || r.status === 'QUEUED' || r.status === 'PROCESSING'
                        ? 'Drawing…'
                        : r.status === 'REJECTED'
                          ? 'Rejected'
                          : 'Unavailable'}
                  </div>
                )}
              </div>
              <p className="mt-2 text-xs text-ink/45">
                {r?.status === 'READY'
                  ? active
                    ? 'Selected'
                    : plot || 'Ready'
                  : slot.error || r?.status || 'Queued'}
              </p>
            </button>
          )
        })}
      </div>

      <p className="text-xs text-ink/40">
        {busy ? 'Generating the set…' : 'Tap a panel to use that style.'}
      </p>
    </section>
  )
}
