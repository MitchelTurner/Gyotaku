const STAGES = [
  { key: 'ingest', label: 'Reading the plate' },
  { key: 'segmenting', label: 'Lifting the specimen' },
  { key: 'analyzing', label: 'Reading the grain' },
  { key: 'drawing', label: 'Drawing the strokes' },
  { key: 'finishing', label: 'Setting the ink' },
] as const

function stageIndex(stage: string | null): number {
  if (!stage) return 0
  const i = STAGES.findIndex((s) => stage.toLowerCase().includes(s.key))
  if (i >= 0) return i
  if (stage === 'queued') return 0
  return 0
}

type Props = {
  stage: string | null
}

export function Processing({ stage }: Props) {
  const active = stageIndex(stage)

  return (
    <section className="flex min-h-dvh flex-col items-center justify-center px-6 py-16 text-center">
      <p className="font-display text-3xl text-ink sm:text-4xl">Gyotaku</p>
      <div className="animate-ink-pulse mt-10 h-14 w-14 rounded-full border border-sea/40 bg-sea/15" />
      <p className="mt-8 font-display text-2xl italic text-sea sm:text-3xl">
        {STAGES[active]?.label ?? 'Working the press…'}
      </p>
      <p className="mt-3 max-w-sm text-sm text-ink/55">
        Generation takes a little while — this is craft, not a filter.
      </p>
      <ol className="mt-10 flex w-full max-w-xs flex-col gap-2 text-left text-sm">
        {STAGES.map((s, i) => (
          <li
            key={s.key}
            className={
              i <= active
                ? 'text-ink'
                : 'text-ink/30'
            }
          >
            <span className="mr-2 inline-block w-4 text-sea">
              {i < active ? '✓' : i === active ? '•' : ''}
            </span>
            {s.label}
          </li>
        ))}
      </ol>
    </section>
  )
}
