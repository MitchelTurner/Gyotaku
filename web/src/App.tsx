import { startTransition, useEffect, useRef, useState } from 'react'
import { HeroUpload } from './components/HeroUpload'
import { Preview, type StyleControls } from './components/Preview'
import { Processing } from './components/Processing'
import { RejectNotice } from './components/RejectNotice'
import { SizeStep } from './components/SizeStep'
import { clampFishLength } from './components/FishSize'
import {
  completeUpload,
  createRendition,
  getRendition,
  presignUpload,
  putUploadBytes,
  type RenditionResponse,
} from './lib/api'
import { prepareUploadFile } from './lib/image'
import { getSessionId } from './lib/session'

type Phase =
  | { name: 'idle' }
  | { name: 'uploading' }
  | { name: 'size'; uploadId: string }
  | { name: 'processing'; renditionId: string; stage: string | null }
  | { name: 'ready'; rendition: RenditionResponse }
  | { name: 'rejected'; rendition: RenditionResponse }
  | { name: 'error'; message: string }

const DEFAULT_CONTROLS: StyleControls = {
  strategy: 'flowfield',
  density: 'default',
  ink: 'default',
  fishLengthIn: null,
}

function styleParamsFromControls(c: StyleControls): Record<string, unknown> {
  const params: Record<string, unknown> = {
    strategy: c.strategy,
    watermark: true,
  }

  if (c.fishLengthIn != null && Number.isFinite(c.fishLengthIn)) {
    params.fish_length_in = clampFishLength(c.fishLengthIn)
  }

  if (c.density === 'sparse') {
    Object.assign(params, {
      posterize_levels: 3,
      seed_count: 2800,
      min_separation_light: 5.5,
      min_separation_dark: 1.6,
    })
  } else if (c.density === 'dense') {
    Object.assign(params, {
      posterize_levels: 5,
      seed_count: 6500,
      min_separation_light: 3.4,
      min_separation_dark: 0.95,
    })
  }

  if (c.ink === 'soft') {
    Object.assign(params, {
      jitter_amplitude: 0.55,
      dropout_threshold: 0.28,
      edge_pass_density: 0.22,
    })
  } else if (c.ink === 'crisp') {
    Object.assign(params, {
      jitter_amplitude: 0.15,
      dropout_threshold: 0.08,
      edge_pass_density: 0.45,
      matte_feather_px: 1.0,
    })
  }

  return params
}

export default function App() {
  const [phase, setPhase] = useState<Phase>({ name: 'idle' })
  const [error, setError] = useState<string | null>(null)
  const [uploadId, setUploadId] = useState<string | null>(null)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000_000))
  const [controls, setControls] = useState<StyleControls>(DEFAULT_CONTROLS)
  const [regenerating, setRegenerating] = useState(false)
  const [starting, setStarting] = useState(false)
  const pollRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [])

  function clearPoll() {
    if (pollRef.current) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  function resetToIdle() {
    clearPoll()
    setUploadId(null)
    setSeed(Math.floor(Math.random() * 1_000_000_000))
    setControls(DEFAULT_CONTROLS)
    setRegenerating(false)
    setStarting(false)
    setError(null)
    setPhase({ name: 'idle' })
  }

  async function pollUntilDone(renditionId: string) {
    clearPoll()
    const tick = async () => {
      try {
        const r = await getRendition(renditionId)
        if (r.status === 'QUEUED' || r.status === 'PROCESSING') {
          setPhase({ name: 'processing', renditionId, stage: r.stage })
          return
        }
        clearPoll()
        setRegenerating(false)
        setStarting(false)
        if (r.status === 'READY') {
          startTransition(() => setPhase({ name: 'ready', rendition: r }))
        } else if (r.status === 'REJECTED') {
          setPhase({ name: 'rejected', rendition: r })
        } else {
          setPhase({
            name: 'error',
            message: r.failureReason || 'Generation failed',
          })
        }
      } catch (e) {
        clearPoll()
        setRegenerating(false)
        setStarting(false)
        setPhase({
          name: 'error',
          message: e instanceof Error ? e.message : 'Polling failed',
        })
      }
    }
    await tick()
    pollRef.current = window.setInterval(tick, 2000)
  }

  async function enqueueRendition(nextUploadId: string, nextControls: StyleControls) {
    const sessionId = getSessionId()
    const rendition = await createRendition({
      uploadId: nextUploadId,
      sessionId,
      seed,
      styleParams: styleParamsFromControls(nextControls),
    })
    if (rendition.status === 'READY') {
      setRegenerating(false)
      setStarting(false)
      setPhase({ name: 'ready', rendition })
      return
    }
    if (rendition.status === 'REJECTED') {
      setRegenerating(false)
      setStarting(false)
      setPhase({ name: 'rejected', rendition })
      return
    }
    setPhase({
      name: 'processing',
      renditionId: rendition.id,
      stage: rendition.stage,
    })
    await pollUntilDone(rendition.id)
  }

  async function handleFile(file: File) {
    setError(null)
    setPhase({ name: 'uploading' })
    try {
      const sessionId = getSessionId()
      const prepared = await prepareUploadFile(file)
      const presign = await presignUpload({
        sessionId,
        filename: prepared.filename,
        contentType: prepared.contentType,
        contentLength: prepared.blob.size,
      })
      await putUploadBytes(
        presign.uploadId,
        presign.uploadUrl,
        prepared.blob,
        prepared.contentType,
      )
      const complete = await completeUpload(presign.uploadId, sessionId)
      setUploadId(complete.id)
      setPhase({ name: 'size', uploadId: complete.id })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Upload failed'
      setError(message)
      setPhase({ name: 'idle' })
    }
  }

  async function startWithControls(next: StyleControls) {
    if (!uploadId) return
    setControls(next)
    setStarting(true)
    setPhase({ name: 'processing', renditionId: '', stage: 'queued' })
    try {
      await enqueueRendition(uploadId, next)
    } catch (e) {
      setStarting(false)
      setPhase({
        name: 'error',
        message: e instanceof Error ? e.message : 'Could not start drawing',
      })
    }
  }

  async function handleRegenerate() {
    if (!uploadId) return
    setRegenerating(true)
    setPhase({ name: 'processing', renditionId: '', stage: 'queued' })
    try {
      await enqueueRendition(uploadId, controls)
    } catch (e) {
      setRegenerating(false)
      setPhase({
        name: 'error',
        message: e instanceof Error ? e.message : 'Could not redraw',
      })
    }
  }

  return (
    <div className="paper-scene min-h-dvh text-ink">
      {(phase.name === 'idle' || phase.name === 'uploading') && (
        <HeroUpload
          busy={phase.name === 'uploading'}
          error={error}
          onFile={handleFile}
        />
      )}

      {phase.name === 'size' && (
        <SizeStep
          fishLengthIn={controls.fishLengthIn}
          onChange={(fishLengthIn) => setControls({ ...controls, fishLengthIn })}
          onContinue={() => startWithControls(controls)}
          onSkipFitToPaper={() =>
            startWithControls({ ...controls, fishLengthIn: null })
          }
          onBack={resetToIdle}
          busy={starting}
        />
      )}

      {phase.name === 'processing' && <Processing stage={phase.stage} />}

      {phase.name === 'ready' && (
        <Preview
          rendition={phase.rendition}
          controls={controls}
          regenerating={regenerating}
          onControlsChange={setControls}
          onRegenerate={handleRegenerate}
          onStartOver={resetToIdle}
        />
      )}

      {phase.name === 'rejected' && (
        <RejectNotice
          reason={phase.rendition.failureReason}
          matteScore={phase.rendition.matteScore}
          onRetry={resetToIdle}
        />
      )}

      {phase.name === 'error' && (
        <section className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
          <p className="font-display text-3xl text-ink">Gyotaku</p>
          <p className="mt-6 max-w-md text-ink/70">{phase.message}</p>
          <button
            type="button"
            onClick={resetToIdle}
            className="mt-8 rounded-sm bg-ink px-6 py-3 text-sm text-foam"
          >
            Start over
          </button>
        </section>
      )}
    </div>
  )
}
