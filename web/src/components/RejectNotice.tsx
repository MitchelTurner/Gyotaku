type Props = {
  reason: string | null
  matteScore: number | null
  onRetry: () => void
}

export function RejectNotice({ reason, matteScore, onRetry }: Props) {
  return (
    <section className="flex min-h-dvh flex-col justify-center px-6 py-16 sm:px-10">
      <div className="mx-auto w-full max-w-lg">
        <p className="font-display text-3xl text-ink">Gyotaku</p>
        <h1 className="mt-8 font-display text-4xl leading-tight text-ink sm:text-5xl">
          We couldn’t lift a clean impression.
        </h1>
        <p className="mt-5 text-base leading-relaxed text-ink/70">
          {reason ||
            'The subject needs to be clearly separated from the background — try a photo with more contrast behind it.'}
        </p>
        {matteScore != null ? (
          <p className="mt-3 text-xs uppercase tracking-[0.16em] text-ink/40">
            Separation score {matteScore.toFixed(2)}
          </p>
        ) : null}
        <ul className="mt-8 space-y-2 text-sm text-ink/65">
          <li>One fish, full body, side or ¾ view</li>
          <li>Plain sky, deck, or wall behind it</li>
          <li>Sharp focus — avoid blur and low light</li>
        </ul>
        <button
          type="button"
          onClick={onRetry}
          className="mt-10 rounded-sm bg-ink px-6 py-3.5 text-sm font-medium text-foam transition hover:bg-sea-deep"
        >
          Try another photo
        </button>
      </div>
    </section>
  )
}
