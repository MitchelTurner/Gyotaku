export function formatPaperSize(
  widthMm: number | null | undefined,
  heightMm: number | null | undefined,
): string | null {
  if (widthMm == null || heightMm == null || widthMm <= 0 || heightMm <= 0) {
    return null
  }
  const wIn = widthMm / 25.4
  const hIn = heightMm / 25.4
  const fmt = (n: number) => {
    const r = Math.round(n * 10) / 10
    return Number.isInteger(r) ? String(r) : r.toFixed(1)
  }
  return `${fmt(wIn)} × ${fmt(hIn)} in`
}

export function formatPlotTime(seconds: number | null | undefined): string | null {
  if (seconds == null || seconds <= 0) return null
  if (seconds < 90) return `~${Math.round(seconds)}s plot`
  const mins = Math.round(seconds / 60)
  return `~${mins} min plot`
}
