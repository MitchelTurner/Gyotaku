import type { ReactNode } from 'react'
import type { RenditionResponse } from '../lib/api'

export type StyleControls = {
  strategy: 'flowfield' | 'contour' | 'stipple'
  density: 'sparse' | 'default' | 'dense'
  ink: 'crisp' | 'default' | 'soft'
}

type Props = {
  rendition: RenditionResponse
  controls: StyleControls
  regenerating: boolean
  onControlsChange: (next: StyleControls) => void
  onRegenerate: () => void
  onStartOver: () => void
}

export function Preview({
  rendition,
  controls,
  regenerating,
  onControlsChange,
  onRegenerate,
  onStartOver,
}: Props) {
  return (
    <section className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-8 lg:flex-row lg:items-start lg:gap-12 lg:py-12">
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <p className="font-display text-2xl text-ink">Gyotaku</p>
          <button
            type="button"
            onClick={onStartOver}
            className="text-xs uppercase tracking-[0.16em] text-ink/45 transition hover:text-ink"
          >
            New photo
          </button>
        </div>

        <div className="animate-preview-in overflow-hidden rounded-sm bg-[linear-gradient(160deg,#f7f9f7,#e4ebe6)] shadow-[0_20px_60px_rgba(20,24,22,0.12)] ring-1 ring-ink/5">
          {rendition.previewUrl ? (
            <img
              src={rendition.previewUrl}
              alt="Gyotaku preview"
              className="mx-auto block h-auto w-full max-h-[75dvh] object-contain"
            />
          ) : (
            <div className="flex aspect-[3/4] items-center justify-center text-sm text-ink/40">
              Preview unavailable
            </div>
          )}
        </div>
        <p className="mt-3 text-xs text-ink/40">
          Watermarked preview
          {rendition.estPlotSeconds
            ? ` · ~${Math.round(rendition.estPlotSeconds / 60)} min plot`
            : ''}
          {rendition.matteScore != null
            ? ` · matte ${rendition.matteScore.toFixed(2)}`
            : ''}
        </p>
      </div>

      <aside className="w-full shrink-0 lg:sticky lg:top-8 lg:w-72">
        <h2 className="font-display text-3xl text-ink">Tune the impression</h2>
        <p className="mt-2 text-sm text-ink/55">
          Each change draws a new rendition from the same photo.
        </p>

        <ControlGroup label="Style">
          {(
            [
              ['flowfield', 'Flow'],
              ['contour', 'Contour'],
              ['stipple', 'Stipple'],
            ] as const
          ).map(([value, label]) => (
            <Choice
              key={value}
              active={controls.strategy === value}
              onClick={() => onControlsChange({ ...controls, strategy: value })}
              label={label}
            />
          ))}
        </ControlGroup>

        <ControlGroup label="Density">
          {(
            [
              ['sparse', 'Open'],
              ['default', 'Balanced'],
              ['dense', 'Heavy'],
            ] as const
          ).map(([value, label]) => (
            <Choice
              key={value}
              active={controls.density === value}
              onClick={() => onControlsChange({ ...controls, density: value })}
              label={label}
            />
          ))}
        </ControlGroup>

        <ControlGroup label="Ink character">
          {(
            [
              ['crisp', 'Crisp'],
              ['default', 'Natural'],
              ['soft', 'Soft'],
            ] as const
          ).map(([value, label]) => (
            <Choice
              key={value}
              active={controls.ink === value}
              onClick={() => onControlsChange({ ...controls, ink: value })}
              label={label}
            />
          ))}
        </ControlGroup>

        <button
          type="button"
          disabled={regenerating}
          onClick={onRegenerate}
          className="mt-8 w-full rounded-sm bg-sea px-5 py-3.5 text-sm font-medium text-foam transition hover:bg-sea-deep disabled:opacity-50"
        >
          {regenerating ? 'Drawing…' : 'Redraw with these settings'}
        </button>
      </aside>
    </section>
  )
}

function ControlGroup({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <div className="mt-7">
      <p className="mb-2 text-[11px] uppercase tracking-[0.18em] text-ink/40">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function Choice({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? 'rounded-sm bg-ink px-3 py-2 text-xs font-medium text-foam'
          : 'rounded-sm bg-ink/5 px-3 py-2 text-xs font-medium text-ink/70 transition hover:bg-ink/10'
      }
    >
      {label}
    </button>
  )
}
