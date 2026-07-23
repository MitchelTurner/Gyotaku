import { FishSizeInput } from './FishSize'

type Props = {
  fishLengthIn: number | null
  onChange: (inches: number | null) => void
  onContinue: () => void
  onSkipFitToPaper: () => void
  onBack: () => void
  busy?: boolean
}

export function SizeStep({
  fishLengthIn,
  onChange,
  onContinue,
  onSkipFitToPaper,
  onBack,
  busy,
}: Props) {
  const ready = fishLengthIn != null && fishLengthIn >= 4 && fishLengthIn <= 60

  return (
    <section className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center px-6 py-12">
      <p className="font-display text-2xl text-ink">Gyotaku</p>
      <h1 className="mt-6 font-display text-4xl leading-tight text-ink sm:text-5xl">
        How long is your fish?
      </h1>
      <p className="mt-3 text-sm text-ink/55">
        Drag the tape or type inches (nose to tail tip). We’ll print the
        impression at true size — species tags on the next screen only nudge
        the drawing style, not the length.
      </p>

      <div className="mt-10">
        <FishSizeInput value={fishLengthIn} onChange={onChange} />
      </div>

      <button
        type="button"
        disabled={!ready || busy}
        onClick={onContinue}
        className="mt-10 w-full rounded-sm bg-sea px-5 py-3.5 text-sm font-medium text-foam transition hover:bg-sea-deep disabled:opacity-40"
      >
        {busy ? 'Starting…' : 'Draw life-size'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onSkipFitToPaper}
        className="mt-3 w-full py-2 text-xs uppercase tracking-[0.16em] text-ink/40 transition hover:text-ink/70"
      >
        Skip — fit to paper instead
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={onBack}
        className="mt-8 text-xs uppercase tracking-[0.16em] text-ink/35 transition hover:text-ink"
      >
        Use a different photo
      </button>
    </section>
  )
}
