const MIN = 4
const MAX = 60

/** Common salmon lengths (nose–tail) for quick pick. */
export const LENGTH_PRESETS: { label: string; inches: number; hint: string }[] = [
  { label: 'Pink', inches: 18, hint: 'humpy' },
  { label: 'Sockeye', inches: 22, hint: 'red' },
  { label: 'Coho', inches: 26, hint: 'silver' },
  { label: 'Chinook', inches: 34, hint: 'king' },
  { label: 'Trophy', inches: 42, hint: 'big king' },
]

type Props = {
  value: number | null
  onChange: (inches: number | null) => void
  id?: string
  showTape?: boolean
}

/** Nose-to-tail length in inches → life-size plot. */
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
        Fish length
      </label>

      <div className="mb-3 flex flex-wrap gap-2">
        {LENGTH_PRESETS.map((p) => {
          const active = clamped != null && Math.abs(clamped - p.inches) < 0.01
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onChange(p.inches)}
              className={
                active
                  ? 'rounded-sm bg-ink px-2.5 py-1.5 text-xs font-medium text-foam'
                  : 'rounded-sm bg-ink/5 px-2.5 py-1.5 text-xs font-medium text-ink/70 transition hover:bg-ink/10'
              }
              title={`${p.hint} · ~${p.inches}"`}
            >
              {p.label}{' '}
              <span className={active ? 'text-foam/60' : 'text-ink/40'}>
                {p.inches}"
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex items-center gap-2">
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

      {showTape && <TapeMeasure inches={clamped} onPick={onChange} />}

      <p className="mt-2 text-xs leading-relaxed text-ink/45">
        Nose to tail tip. The plot is drawn at this exact length
        {clamped != null
          ? ` (${formatInches(clamped)} · paper grows to fit).`
          : ' (leave blank to fit a standard sheet).'}
      </p>
    </div>
  )
}

/** Visual inch tape — click along the scale to set length. */
function TapeMeasure({
  inches,
  onPick,
}: {
  inches: number | null
  onPick: (n: number) => void
}) {
  const labels = [12, 24, 36, 48, 60]
  const pct =
    inches != null ? ((clamp(inches) - MIN) / (MAX - MIN)) * 100 : null

  return (
    <div className="mt-4">
      <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-ink/40">
        Tape
      </p>
      <button
        type="button"
        className="relative block h-11 w-full overflow-hidden rounded-sm bg-[linear-gradient(180deg,#f0ebe3,#e4ddd2)] text-left ring-1 ring-ink/10"
        aria-label="Fish length tape measure"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
          const n = Math.round((MIN + x * (MAX - MIN)) * 4) / 4
          onPick(clamp(n))
        }}
      >
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox={`0 0 ${MAX - MIN} 44`}
          preserveAspectRatio="none"
          aria-hidden
        >
          {Array.from({ length: MAX - MIN + 1 }, (_, i) => {
            const inch = MIN + i
            const major = inch % 6 === 0
            const mid = inch % 2 === 0
            const h = major ? 28 : mid ? 16 : 8
            return (
              <line
                key={inch}
                x1={i}
                x2={i}
                y1={0}
                y2={h}
                stroke="rgba(20,24,22,0.28)"
                strokeWidth={major ? 0.15 : 0.08}
                vectorEffect="non-scaling-stroke"
              />
            )
          })}
        </svg>
        <div className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-between px-1 text-[9px] text-ink/45">
          {labels.map((m) => (
            <span
              key={m}
              className="absolute -translate-x-1/2"
              style={{ left: `${((m - MIN) / (MAX - MIN)) * 100}%` }}
            >
              {m}"
            </span>
          ))}
        </div>
        {pct != null && (
          <span
            className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-sea transition-[left] duration-200"
            style={{ left: `calc(${pct}% - 1px)` }}
          >
            <span className="absolute left-1/2 top-1 -translate-x-1/2 whitespace-nowrap rounded-sm bg-sea px-1.5 py-0.5 text-[10px] font-medium text-foam">
              {formatInches(inches!)}
            </span>
          </span>
        )}
      </button>
      <p className="mt-1.5 text-[10px] text-ink/35">Tap the tape to set length</p>
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
