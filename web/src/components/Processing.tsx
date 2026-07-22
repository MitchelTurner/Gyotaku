/**
 * Honest progress — labels map to stages the worker already emits.
 * See generator pipeline: ingest → segmenting → analyzing → drawing → finishing.
 */
const STAGES = [
  {
    key: 'queued',
    match: ['queued'],
    label: 'Waiting in the queue…',
    detail: 'Your photo is next on the press.',
  },
  {
    key: 'ingest',
    match: ['ingest'],
    label: 'Reading the plate…',
    detail: 'Loading and normalizing the photo.',
  },
  {
    key: 'segmenting',
    match: ['segmenting', 'segment'],
    label: 'Cutting the matte…',
    detail: 'Isolating the fish from the background.',
  },
  {
    key: 'analyzing',
    match: ['analyzing', 'analyze', 'tonal'],
    label: 'Reading tone & grain…',
    detail: 'Mapping light, dark, and stroke direction.',
  },
  {
    key: 'drawing',
    match: ['drawing', 'marks', 'ink'],
    label: 'Inking the strokes…',
    detail: 'Laying denser marks in the darks.',
  },
  {
    key: 'finishing',
    match: ['finishing', 'finish', 'optimize'],
    label: 'Setting the ink…',
    detail: 'Simplifying paths and rendering the preview.',
  },
] as const

function stageIndex(stage: string | null): number {
  if (!stage) return 0
  const s = stage.toLowerCase()
  if (s === 'done') return STAGES.length - 1
  const i = STAGES.findIndex((row) => row.match.some((m) => s.includes(m)))
  return i >= 0 ? i : 0
}

type Props = {
  stage: string | null
}

export function Processing({ stage }: Props) {
  const active = stageIndex(stage)
  const current = STAGES[active]

  return (
    <section className="flex min-h-dvh flex-col items-center justify-center px-6 py-16 text-center">
      <p className="font-display text-3xl text-ink sm:text-4xl">Gyotaku</p>
      <div
        className="animate-ink-pulse mt-10 h-14 w-14 rounded-full border border-sea/40 bg-sea/15"
        aria-hidden
      />
      <p
        key={current.key}
        className="animate-preview-in mt-8 font-display text-2xl italic text-sea sm:text-3xl"
      >
        {current.label}
      </p>
      <p className="mt-3 max-w-sm text-sm text-ink/55">{current.detail}</p>
      <ol className="mt-10 flex w-full max-w-xs flex-col gap-2 text-left text-sm">
        {STAGES.map((s, i) => (
          <li
            key={s.key}
            className={i <= active ? 'text-ink transition-colors' : 'text-ink/30'}
          >
            <span className="mr-2 inline-block w-4 text-sea" aria-hidden>
              {i < active ? '✓' : i === active ? '•' : ''}
            </span>
            {s.label.replace(/…$/, '')}
          </li>
        ))}
      </ol>
      {stage && (
        <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.14em] text-ink/30">
          stage · {stage}
        </p>
      )}
    </section>
  )
}
