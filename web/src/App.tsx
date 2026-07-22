import { startTransition, useEffect, useRef, useState } from 'react'
import {
  CompareStrategies,
  type StrategyName,
} from './components/CompareStrategies'
import { HeroUpload } from './components/HeroUpload'
import { OrderStatus } from './components/OrderStatus'
import { OrderStep } from './components/OrderStep'
import { Preview, type StyleControls } from './components/Preview'
import { Processing } from './components/Processing'
import { RejectNotice } from './components/RejectNotice'
import { ShareLanding } from './components/ShareLanding'
import { SizeStep } from './components/SizeStep'
import { clampFishLength } from './components/FishSize'
import {
  completeUpload,
  createRendition,
  getAffiliate,
  getRendition,
  presignUpload,
  putUploadBytes,
  type AffiliatePublic,
  type ProductType,
  type ReorderRecipe,
  type RenditionResponse,
} from './lib/api'
import {
  controlsForNewPhoto,
  DEFAULT_CONTROLS,
  loadControls,
  loadSeed,
  saveControls,
  saveSeed,
} from './lib/controls'
import { prepareUploadFile } from './lib/image'
import {
  getAffiliateCode,
  getSessionId,
  setAffiliateCode,
} from './lib/session'

type CompareSlot = {
  strategy: StrategyName
  rendition: RenditionResponse | null
  error: string | null
}

type Phase =
  | { name: 'idle' }
  | { name: 'share'; renditionId: string }
  | { name: 'uploading' }
  | { name: 'size'; uploadId: string }
  | { name: 'processing'; renditionId: string; stage: string | null }
  | { name: 'ready'; rendition: RenditionResponse }
  | { name: 'compare'; slots: CompareSlot[]; busy: boolean }
  | {
      name: 'order'
      rendition: RenditionResponse
      preferProduct?: ProductType
    }
  | { name: 'orderResult'; orderId: string; kind: 'success' | 'cancel' }
  | { name: 'rejected'; rendition: RenditionResponse }
  | { name: 'error'; message: string }

const COMPARE_STRATEGIES: StrategyName[] = ['flowfield', 'contour', 'stipple']

function styleParamsFromControls(c: StyleControls): Record<string, unknown> {
  const params: Record<string, unknown> = {
    strategy: c.strategy,
    watermark: true,
  }

  if (c.fishLengthIn != null && Number.isFinite(c.fishLengthIn)) {
    params.fish_length_in = clampFishLength(c.fishLengthIn)
  }

  if (c.species) params.species = c.species
  if (c.side) params.side = c.side

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

function controlsFromStyleParams(style: Record<string, unknown>): StyleControls {
  const strategy =
    style.strategy === 'contour' || style.strategy === 'stipple'
      ? style.strategy
      : 'flowfield'
  const fishLengthIn =
    typeof style.fish_length_in === 'number' ? style.fish_length_in : null
  const species =
    style.species === 'chinook' ||
    style.species === 'coho' ||
    style.species === 'sockeye' ||
    style.species === 'other'
      ? style.species
      : null
  const side =
    style.side === 'left' || style.side === 'right' || style.side === 'unknown'
      ? style.side
      : null
  return {
    ...DEFAULT_CONTROLS,
    strategy,
    fishLengthIn,
    species,
    side,
  }
}

function readOrderReturn(): { kind: 'success' | 'cancel'; orderId: string } | null {
  const params = new URLSearchParams(window.location.search)
  const order = params.get('order')
  const orderId = params.get('orderId')
  if ((order === 'success' || order === 'cancel') && orderId) {
    return { kind: order, orderId }
  }
  return null
}

function readShareId(): string | null {
  const params = new URLSearchParams(window.location.search)
  return params.get('p')
}

function readAffiliateRef(): string | null {
  const params = new URLSearchParams(window.location.search)
  const ref = params.get('ref')
  return ref && ref.trim() ? ref.trim() : null
}

function clearOrderQuery() {
  const url = new URL(window.location.href)
  url.searchParams.delete('order')
  url.searchParams.delete('orderId')
  window.history.replaceState({}, '', url.pathname + url.search)
}

function clearShareQuery() {
  const url = new URL(window.location.href)
  url.searchParams.delete('p')
  window.history.replaceState({}, '', url.pathname + url.search)
}

function clearAffiliateQuery() {
  const url = new URL(window.location.href)
  url.searchParams.delete('ref')
  window.history.replaceState({}, '', url.pathname + url.search)
}

/** Capture captain QR ?ref= on any entry URL. */
function captureAffiliateRef() {
  const ref = readAffiliateRef()
  if (!ref) return
  setAffiliateCode(ref)
  clearAffiliateQuery()
}

function initialPhase(): Phase {
  captureAffiliateRef()
  const ret = readOrderReturn()
  if (ret) return { name: 'orderResult', ...ret }
  const shareId = readShareId()
  if (shareId) return { name: 'share', renditionId: shareId }
  return { name: 'idle' }
}

export default function App() {
  const [phase, setPhase] = useState<Phase>(initialPhase)
  const [error, setError] = useState<string | null>(null)
  const [uploadId, setUploadId] = useState<string | null>(null)
  const [seed, setSeed] = useState(() => loadSeed())
  const [controls, setControls] = useState<StyleControls>(() => loadControls())
  const [regenerating, setRegenerating] = useState(false)
  const [starting, setStarting] = useState(false)
  const [lastReady, setLastReady] = useState<RenditionResponse | null>(null)
  const [affiliate, setAffiliate] = useState<AffiliatePublic | null>(null)
  const pollRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current)
    }
  }, [])

  // Resolve captain from sticky ?ref= code for guest UI + checkout attribution
  useEffect(() => {
    const code = getAffiliateCode()
    if (!code) {
      setAffiliate(null)
      return
    }
    let cancelled = false
    void getAffiliate(code)
      .then((a) => {
        if (!cancelled) setAffiliate(a)
      })
      .catch(() => {
        if (!cancelled) setAffiliate(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Sticky style controls + seed across redraws / return visits
  useEffect(() => {
    saveControls(controls)
  }, [controls])

  useEffect(() => {
    saveSeed(seed)
  }, [seed])

  function clearPoll() {
    if (pollRef.current) {
      window.clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  function resetToIdle() {
    clearPoll()
    clearOrderQuery()
    clearShareQuery()
    setUploadId(null)
    setLastReady(null)
    // Keep density / ink / strategy sticky; clear length for the new catch
    const nextControls = controlsForNewPhoto(controls)
    const nextSeed = Math.floor(Math.random() * 1_000_000_000)
    setSeed(nextSeed)
    setControls(nextControls)
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
          setLastReady(r)
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
      setLastReady(rendition)
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

  async function handleCompare() {
    if (!uploadId) return
    clearPoll()
    const sessionId = getSessionId()
    let slots: CompareSlot[] = COMPARE_STRATEGIES.map((strategy) => ({
      strategy,
      rendition: null,
      error: null,
    }))
    setPhase({ name: 'compare', slots, busy: true })

    try {
      const created = await Promise.all(
        COMPARE_STRATEGIES.map(async (strategy) => {
          try {
            const rendition = await createRendition({
              uploadId,
              sessionId,
              seed,
              styleParams: styleParamsFromControls({ ...controls, strategy }),
            })
            return { strategy, rendition, error: null as string | null }
          } catch (e) {
            return {
              strategy,
              rendition: null,
              error: e instanceof Error ? e.message : 'Failed',
            }
          }
        }),
      )
      slots = created
      setPhase({ name: 'compare', slots, busy: true })

      const pending = created.filter(
        (s) =>
          s.rendition &&
          (s.rendition.status === 'QUEUED' || s.rendition.status === 'PROCESSING'),
      )
      if (pending.length === 0) {
        setPhase({ name: 'compare', slots, busy: false })
        return
      }

      const tick = async () => {
        const next = await Promise.all(
          slots.map(async (slot) => {
            if (!slot.rendition) return slot
            if (
              slot.rendition.status !== 'QUEUED' &&
              slot.rendition.status !== 'PROCESSING'
            ) {
              return slot
            }
            try {
              const r = await getRendition(slot.rendition.id)
              return { ...slot, rendition: r }
            } catch (e) {
              return {
                ...slot,
                error: e instanceof Error ? e.message : 'Poll failed',
              }
            }
          }),
        )
        slots = next
        const still = next.some(
          (s) =>
            s.rendition &&
            (s.rendition.status === 'QUEUED' || s.rendition.status === 'PROCESSING'),
        )
        setPhase({ name: 'compare', slots: next, busy: still })
        if (!still) clearPoll()
      }
      await tick()
      pollRef.current = window.setInterval(tick, 2000)
    } catch (e) {
      setPhase({
        name: 'error',
        message: e instanceof Error ? e.message : 'Compare failed',
      })
    }
  }

  async function handleReorder(recipe: ReorderRecipe, preferProduct?: ProductType) {
    clearOrderQuery()
    try {
      const r = await getRendition(recipe.renditionId)
      if (r.status !== 'READY') {
        setPhase({
          name: 'error',
          message: 'That print is no longer available to reorder',
        })
        return
      }
      setUploadId(recipe.uploadId)
      setSeed(recipe.seed)
      setControls(controlsFromStyleParams(recipe.styleParams || {}))
      setLastReady(r)
      if (preferProduct) {
        setPhase({ name: 'order', rendition: r, preferProduct })
      } else {
        setPhase({ name: 'ready', rendition: r })
      }
    } catch (e) {
      setPhase({
        name: 'error',
        message: e instanceof Error ? e.message : 'Could not reload print',
      })
    }
  }

  return (
    <div className="paper-scene min-h-dvh text-ink">
      {phase.name === 'share' && (
        <ShareLanding
          renditionId={phase.renditionId}
          onMakeYours={() => {
            clearShareQuery()
            setPhase({ name: 'idle' })
          }}
        />
      )}

      {(phase.name === 'idle' || phase.name === 'uploading') && (
        <HeroUpload
          busy={phase.name === 'uploading'}
          error={error}
          onFile={handleFile}
          affiliate={affiliate}
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
          onCompare={handleCompare}
          onOrder={() => setPhase({ name: 'order', rendition: phase.rendition })}
          onStartOver={resetToIdle}
        />
      )}

      {phase.name === 'compare' && (
        <CompareStrategies
          slots={phase.slots}
          selectedId={lastReady?.id ?? null}
          busy={phase.busy}
          onSelect={(rendition, strategy) => {
            clearPoll()
            setControls({ ...controls, strategy })
            setLastReady(rendition)
            startTransition(() => setPhase({ name: 'ready', rendition }))
          }}
          onClose={() => {
            clearPoll()
            if (lastReady) {
              setPhase({ name: 'ready', rendition: lastReady })
            } else {
              setPhase({ name: 'error', message: 'No preview selected' })
            }
          }}
        />
      )}

      {phase.name === 'order' && (
        <OrderStep
          rendition={phase.rendition}
          fishLengthIn={
            controls.fishLengthIn ?? phase.rendition.fishLengthIn ?? null
          }
          initialProductType={phase.preferProduct}
          affiliate={affiliate}
          onBack={() => setPhase({ name: 'ready', rendition: phase.rendition })}
          onStartOver={resetToIdle}
        />
      )}

      {phase.name === 'orderResult' && (
        <OrderStatus
          orderId={phase.orderId}
          kind={phase.kind}
          onReorder={handleReorder}
          onDone={() => {
            clearOrderQuery()
            if (phase.kind === 'cancel' && lastReady) {
              setPhase({ name: 'ready', rendition: lastReady })
            } else {
              resetToIdle()
            }
          }}
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
