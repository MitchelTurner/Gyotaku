const MIN = 4
const MAX = 60

type Props = {
  value: number | null
  onChange: (inches: number | null) => void
  id?: string
}

/** Nose-to-tail length in inches → life-size plot. */
export function FishSizeInput({ value, onChange, id = 'fish-length' }: Props) {
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block text-[11px] uppercase tracking-[0.18em] text-ink/40"
      >
        Fish length
      </label>
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
      <p className="mt-2 text-xs leading-relaxed text-ink/45">
        Nose to tail tip. The plot is drawn at this exact length
        {value != null && Number.isFinite(value)
          ? ` (${formatInches(clamp(value))} · paper grows to fit).`
          : ' (leave blank to fit a standard sheet).'}
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
