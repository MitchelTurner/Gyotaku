type Props = {
  busy: boolean
  error: string | null
  onFile: (file: File) => void
}

const TIPS = [
  { title: 'Side view', body: 'Nose-to-tail profile shows the silhouette best.' },
  { title: 'Plain background', body: 'Grass, dock, or cooler lid — not busy foliage.' },
  { title: 'Sharp & bright', body: 'Hold steady; avoid dusk blur and heavy shade.' },
]

export function HeroUpload({ busy, error, onFile }: Props) {
  return (
    <section className="flex min-h-dvh flex-col justify-end px-5 pb-10 pt-8 sm:px-10 sm:pb-14">
      <header className="animate-rise mb-auto flex items-baseline justify-between gap-4">
        <p className="font-display text-4xl tracking-tight text-ink sm:text-5xl">
          Gyotaku
        </p>
        <p className="max-w-[12rem] text-right text-[11px] uppercase tracking-[0.18em] text-sea-deep/70">
          Pen-plotter prints
        </p>
      </header>

      <div className="mx-auto w-full max-w-xl">
        <h1 className="animate-rise-delay font-display text-[clamp(2.6rem,10vw,4.8rem)] leading-[0.95] text-ink">
          Your catch,
          <br />
          <span className="italic text-sea">as ink.</span>
        </h1>
        <p className="animate-rise-delay-2 mt-5 max-w-md text-base leading-relaxed text-ink/70 sm:text-lg">
          Upload a fish photo. We isolate the specimen and draw it as
          plotter-ready strokes — tone from mark density, floating on paper.
        </p>

        <label className="animate-rise-delay-2 group mt-9 flex cursor-pointer flex-col items-start gap-3">
          <span className="inline-flex items-center gap-3 rounded-sm bg-ink px-6 py-3.5 text-sm font-medium tracking-wide text-foam transition duration-300 group-hover:bg-sea-deep group-active:scale-[0.98]">
            {busy ? 'Preparing…' : 'Upload a photo'}
            <span aria-hidden className="text-mist">
              →
            </span>
          </span>
          <span className="text-xs text-ink/50">
            JPEG, PNG, or HEIC · phone camera welcome
          </span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="sr-only"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onFile(file)
              e.target.value = ''
            }}
          />
        </label>

        {error ? (
          <p className="mt-5 text-sm text-warn" role="alert">
            {error}
          </p>
        ) : null}

        {/* Tips sit below the CTA — keeps the first viewport brand + one CTA */}
        <aside className="animate-rise-delay-2 mt-10 border-t border-ink/10 pt-6">
          <p className="text-[11px] uppercase tracking-[0.18em] text-ink/40">
            Before you shoot
          </p>
          <ul className="mt-3 space-y-2.5">
            {TIPS.map((tip) => (
              <li key={tip.title} className="text-sm leading-snug text-ink/60">
                <span className="font-medium text-ink/80">{tip.title}</span>
                <span className="text-ink/40"> — </span>
                {tip.body}
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </section>
  )
}
