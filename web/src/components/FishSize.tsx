import { useCallback, useRef } from 'react'

const MIN = 4
const MAX = 60

type Props = {
  value: number | null
  onChange: (inches: number | null) => void
  id?: string
  showTape?: boolean
}

/** Nose-to-tail length in inches → life-size print. */
export function FishSizeInput({
  value,
  onChange,
  id = 'fish-length',
  showTape = true,
}: Props) {
  const clamped =
    value != null && Number.isFinite(value) ? clamp(value) : null

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block text-[11px] uppercase tracking-[0.18em] text-ink/40"
      >
        Fish length (nose to tip)
      </label>

      {showTape && (
        <TapeMeasure
          inches={clamped}
          onPick={(n) => onChange(clamp(n))}
        />
      )}

      <div className="mt-4 flex items-center gap-2">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          min={MIN}
          max={MAX}
          step={0.25}
          placeholder="e.g. 28"
          value={value ?? ''}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') {
              onChange(null)
              return
            }
            const n = Number(raw)
            if (Number.isFinite(n)) onChange(n)
          }}
          className="w-full rounded-sm border border-ink/15 bg-foam/60 px-3 py-2.5 text-sm text-ink outline-none transition focus:border-sea"
        />
        <span className="shrink-0 text-sm text-ink/50">in</span>
      </div>

      <p className="mt-2 text-xs leading-relaxed text-ink/45">
        Measure nose to tail tip. The print is drawn at this exact length
        {clamped != null
          ? ` (${formatInches(clamped)} · paper grows to fit).`
          : ' (or skip below to fit a standard sheet).'}
      </p>
    </div>
  )
}

/** High-contrast inch tape — click or drag along the scale to set length. */
function TapeMeasure({
  inches,
  onPick,
}: {
  inches: number | null
  onPick: (n: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const pickFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      const n = Math.round((MIN + x * (MAX - MIN)) * 4) / 4
      onPick(clamp(n))
    },
    [onPick],
  )

  const pct =
    inches != null ? ((clamp(inches) - MIN) / (MAX - MIN)) * 100 : null

  const ticks = Array.from({ length: MAX - MIN + 1 }, (_, i) => MIN + i)
  const labelInches = [4, 12, 24, 36, 48, 60]

  return (
    <div>
      <div className="mb-2 flex items-end justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-ink/40">
          Tape measure
        </p>
        <p className="font-display text-2xl tabular-nums text-ink">
          {inches != null ? formatInches(inches) : '—'}
        </p>
      </div>

      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Fish length tape measure"
        aria-valuemin={MIN}
        aria-valuemax={MAX}
        aria-valuenow={inches ?? undefined}
        aria-valuetext={inches != null ? formatInches(inches) : 'not set'}
        className="relative h-20 w-full cursor-pointer touch-none select-none overflow-hidden rounded-sm bg-gradient-to-b from-foam via-paper to-mist ring-1 ring-ink/15 outline-none focus-visible:ring-2 focus-visible:ring-sea"
        onPointerDown={(e) => {
          dragging.current = true
          e.currentTarget.setPointerCapture(e.pointerId)
          pickFromClientX(e.clientX)
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return
          pickFromClientX(e.clientX)
        }}
        onPointerUp={() => {
          dragging.current = false
        }}
        onPointerCancel={() => {
          dragging.current = false
        }}
        onKeyDown={(e) => {
          const base = inches ?? 24
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault()
            onPick(clamp(base + (e.shiftKey ? 1 : 0.25)))
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault()
            onPick(clamp(base - (e.shiftKey ? 1 : 0.25)))
          }
        }}
      >
        {/* Inch ticks — CSS so they stay visible at any width */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-12">
          {ticks.map((inch) => {
            const major = inch % 6 === 0
            const mid = inch % 2 === 0
            const left = ((inch - MIN) / (MAX - MIN)) * 100
            const h = major ? '100%' : mid ? '62%' : '34%'
            return (
              <span
                key={inch}
                className="absolute top-0 w-px -translate-x-1/2 bg-ink"
                style={{
                  left: `${left}%`,
                  height: h,
                  opacity: major ? 0.85 : mid ? 0.55 : 0.35,
                  width: major ? 2 : 1,
                }}
              />
            )
          })}
        </div>

        {/* Foot / inch labels */}
        <div className="pointer-events-none absolute inset-x-0 bottom-1.5 h-5">
          {labelInches.map((m) => (
            <span
              key={m}
              className="absolute -translate-x-1/2 text-[11px] font-semibold tabular-nums text-ink/80"
              style={{ left: `${((m - MIN) / (MAX - MIN)) * 100}%` }}
            >
              {m}"
            </span>
          ))}
        </div>

        {/* Selection marker */}
        {pct != null && (
          <span
            className="pointer-events-none absolute top-0 bottom-0 z-10 w-1 -translate-x-1/2 bg-sea ring-2 ring-foam/80"
            style={{ left: `${pct}%` }}
          >
            <span className="absolute left-1/2 top-1.5 -translate-x-1/2 whitespace-nowrap rounded-sm bg-sea px-2 py-0.5 text-[11px] font-semibold text-foam">
              {formatInches(inches!)}
            </span>
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-ink/50">
        Drag or tap the tape · arrows adjust by ¼" (Shift = 1")
      </p>
    </div>
  )
}

export function clampFishLength(n: number): number {
  return clamp(n)
}

function clamp(n: number): number {
  return Math.min(MAX, Math.max(MIN, n))
}

function formatInches(n: number): string {
  const rounded = Math.round(n * 4) / 4
  return `${rounded}"`
}
