import { useEffect, useState } from 'react'
import { getShareRendition, type ShareRenditionResponse } from '../lib/api'
import { formatPaperSize, formatPlotTime } from '../lib/format'

type Props = {
  renditionId: string
  onMakeYours: () => void
}

export function ShareLanding({ renditionId, onMakeYours }: Props) {
  const [share, setShare] = useState<ShareRenditionResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const s = await getShareRendition(renditionId)
        if (!cancelled) setShare(s)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load share')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [renditionId])

  const paper = share
    ? formatPaperSize(share.paperWidthMm, share.paperHeightMm)
    : null
  const plot = share ? formatPlotTime(share.estPlotSeconds) : null

  return (
    <section className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-8">
      <p className="font-display text-2xl text-ink">Gyotaku</p>
      <div>
        <h1 className="font-display text-4xl text-ink sm:text-5xl">A shared print</h1>
        <p className="mt-3 max-w-xl text-sm text-ink/55">
          Watermarked preview of a plotter impression. Make one from your own catch.
        </p>
      </div>

      {error && <p className="text-sm text-red-800/80">{error}</p>}

      {share?.previewUrl && (
        <img
          src={share.previewUrl}
          alt="Shared gyotaku preview"
          className="w-full rounded-sm object-contain ring-1 ring-ink/5"
        />
      )}

      {share && (
        <p className="text-xs text-ink/40">
          {[
            share.fishLengthIn != null ? `Life-size ${share.fishLengthIn}"` : null,
            paper ? `Paper ${paper}` : null,
            plot,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}

      <button
        type="button"
        onClick={onMakeYours}
        className="w-full rounded-sm bg-sea px-5 py-3.5 text-sm font-medium text-foam transition hover:bg-sea-deep"
      >
        Make yours from a photo
      </button>
    </section>
  )
}
