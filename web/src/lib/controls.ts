import type { StyleControls } from '../components/Preview'

const CONTROLS_KEY = 'gyotaku.controls'
const SEED_KEY = 'gyotaku.seed'

export const DEFAULT_CONTROLS: StyleControls = {
  strategy: 'flowfield',
  density: 'default',
  ink: 'default',
  colorMode: 'black_and_white',
  fishLengthIn: null,
  species: null,
  side: null,
}

export function loadControls(): StyleControls {
  try {
    const raw = localStorage.getItem(CONTROLS_KEY)
    if (!raw) return { ...DEFAULT_CONTROLS }
    const parsed = JSON.parse(raw) as Partial<StyleControls>
    return {
      strategy:
        parsed.strategy === 'contour' || parsed.strategy === 'stipple'
          ? parsed.strategy
          : 'flowfield',
      density:
        parsed.density === 'sparse' || parsed.density === 'dense'
          ? parsed.density
          : 'default',
      ink:
        parsed.ink === 'crisp' || parsed.ink === 'soft' ? parsed.ink : 'default',
      colorMode:
        parsed.colorMode === 'fish_color' || parsed.colorMode === 'vibrant'
          ? parsed.colorMode
          : 'black_and_white',
      fishLengthIn:
        typeof parsed.fishLengthIn === 'number' && Number.isFinite(parsed.fishLengthIn)
          ? parsed.fishLengthIn
          : null,
      species:
        parsed.species === 'chinook' ||
        parsed.species === 'coho' ||
        parsed.species === 'sockeye' ||
        parsed.species === 'pink' ||
        parsed.species === 'other'
          ? parsed.species
          : null,
      side:
        parsed.side === 'left' || parsed.side === 'right' || parsed.side === 'unknown'
          ? parsed.side
          : null,
    }
  } catch {
    return { ...DEFAULT_CONTROLS }
  }
}

export function saveControls(controls: StyleControls) {
  try {
    localStorage.setItem(CONTROLS_KEY, JSON.stringify(controls))
  } catch {
    /* ignore quota / private mode */
  }
}

export function loadSeed(): number {
  try {
    const raw = localStorage.getItem(SEED_KEY)
    if (!raw) return Math.floor(Math.random() * 1_000_000_000)
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0) return Math.floor(n)
  } catch {
    /* ignore */
  }
  return Math.floor(Math.random() * 1_000_000_000)
}

export function saveSeed(seed: number) {
  try {
    localStorage.setItem(SEED_KEY, String(seed))
  } catch {
    /* ignore */
  }
}

/** New photo: keep style prefs sticky, clear length for the new catch. */
export function controlsForNewPhoto(prev: StyleControls): StyleControls {
  return {
    ...prev,
    fishLengthIn: null,
  }
}
