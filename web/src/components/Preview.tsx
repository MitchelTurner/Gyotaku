import type { ReactNode } from 'react'
import { useState } from 'react'
import type { RenditionResponse } from '../lib/api'
import { formatPaperSize, formatPlotTime } from '../lib/format'
import { FishSizeInput } from './FishSize'

export type SpeciesTag =
  | 'chinook'
  | 'coho'
  | 'sockeye'
  | 'pink'
  | 'other'
  | null
export type SideTag = 'left' | 'right' | 'unknown' | null

export type ColorMode = 'black_and_white' | 'fish_color' | 'vibrant'

export type StyleControls = {
  strategy: 'flowfield' | 'contour' | 'stipple'
  density: 'sparse' | 'default' | 'dense'
  ink: 'crisp' | 'default' | 'soft'
  colorMode: ColorMode
  fishLengthIn: number | null
  species: SpeciesTag
  side: SideTag
}

type Props = {
  rendition: RenditionResponse
  controls: StyleControls
  regenerating: boolean
  onControlsChange: (next: StyleControls) => void
  onRegenerate: () => void
  onCompare: () => void
  onOrder: () => void
  onStartOver: () => void
}

export function Preview({
  rendition,
  controls,
  regenerating,
  onControlsChange,
  onRegenerate,
  onCompare,
  onOrder,
  onStartOver,
}: Props) {
  const [copied, setCopied] = useState(false)
  const lengthLabel =
    controls.fishLengthIn != null
      ? ` · life-size ${formatLen(controls.fishLengthIn)}`
      : ''
  const paper = formatPaperSize(rendition.paperWidthMm, rendition.paperHeightMm)
  const plot = formatPlotTime(rendition.estPlotSeconds)

  async function handleShare() {
    const url = `${window.location.origin}/?p=${rendition.id}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy share link', url)
    }
  }

  return (
    <section className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-8 lg:flex-row lg:items-start lg:gap-12 lg:py-12">
      <div className="min-w-0 flex-1">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <p className="font-display text-2xl text-ink">Gyotaku</p>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleShare}
              className="text-xs uppercase tracking-[0.16em] text-ink/45 transition hover:text-ink"
            >
              {copied ? 'Link copied' : 'Share'}
            </button>
            <button
              type="button"
              onClick={onStartOver}
              className="text-xs uppercase tracking-[0.16em] text-ink/45 transition hover:text-ink"
            >
              New photo
            </button>
          </div>
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
          {lengthLabel}
          {paper ? ` · paper ${paper}` : ''}
          {plot ? ` · ${plot}` : ''}
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

        <div className="mt-7">
          <FishSizeInput
            value={controls.fishLengthIn}
            onChange={(fishLengthIn) =>
              onControlsChange({ ...controls, fishLengthIn })
            }
          />
        </div>

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

        <ControlGroup label="Color">
          {(
            [
              ['black_and_white', 'Black & white'],
              ['fish_color', 'Fish color'],
              ['vibrant', 'Vibrant'],
            ] as const
          ).map(([value, label]) => (
            <Choice
              key={value}
              active={controls.colorMode === value}
              onClick={() =>
                onControlsChange({ ...controls, colorMode: value })
              }
              label={label}
            />
          ))}
        </ControlGroup>

        <ControlGroup label="Species (optional — style only)">
          {(
            [
              [null, 'Any'],
              ['chinook', 'King'],
              ['coho', 'Coho'],
              ['sockeye', 'Sockeye'],
              ['pink', 'Pink'],
            ] as const
          ).map(([value, label]) => (
            <Choice
              key={label}
              active={controls.species === value}
              onClick={() => onControlsChange({ ...controls, species: value })}
              label={label}
            />
          ))}
        </ControlGroup>

        <ControlGroup label="Side (optional)">
          {(
            [
              [null, 'Any'],
              ['left', 'Left'],
              ['right', 'Right'],
            ] as const
          ).map(([value, label]) => (
            <Choice
              key={label}
              active={controls.side === value}
              onClick={() => onControlsChange({ ...controls, side: value })}
              label={label}
            />
          ))}
        </ControlGroup>

        <button
          type="button"
          disabled={regenerating}
          onClick={onOrder}
          className="mt-8 w-full rounded-sm bg-sea px-5 py-3.5 text-sm font-medium text-foam transition hover:bg-sea-deep disabled:opacity-50"
        >
          Order this print
        </button>
        <button
          type="button"
          disabled={regenerating}
          onClick={onCompare}
          className="mt-3 w-full rounded-sm border border-ink/15 px-5 py-3 text-sm font-medium text-ink/80 transition hover:border-ink/30 disabled:opacity-50"
        >
          Compare styles side-by-side
        </button>
        <button
          type="button"
          disabled={regenerating}
          onClick={onRegenerate}
          className="mt-3 w-full rounded-sm bg-ink/5 px-5 py-3 text-sm font-medium text-ink/80 transition hover:bg-ink/10 disabled:opacity-50"
        >
          {regenerating ? 'Drawing…' : 'Redraw with these settings'}
        </button>
      </aside>
    </section>
  )
}

function formatLen(n: number): string {
  const rounded = Math.round(n * 4) / 4
  return `${rounded}"`
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
