/**
 * Estimate how many calendar days until the plotted-original queue clears,
 * given outstanding plot seconds and how many plot-hours/day the operator runs.
 */

export type QueueOrder = {
  status: string;
  estPlotSeconds: number | null;
};

export function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Seconds still owed for orders that haven't finished plotting. */
export function outstandingPlotSeconds(orders: QueueOrder[]): number {
  const active = new Set(['PAID', 'PLOTTING']);
  let total = 0;
  for (const o of orders) {
    if (!active.has(o.status)) continue;
    const est = o.estPlotSeconds && o.estPlotSeconds > 0 ? o.estPlotSeconds : 45 * 60;
    const overhead = intEnv('PLOTTED_ORDER_OVERHEAD_SECONDS', 30 * 60);
    total += est + overhead;
  }
  return total;
}

export function queueEtaDays(orders: QueueOrder[]): number {
  const seconds = outstandingPlotSeconds(orders);
  if (seconds <= 0) return 0;
  const hoursPerDay = Math.max(0.5, intEnv('PLOTTED_PLOT_HOURS_PER_DAY', 4));
  const days = seconds / (hoursPerDay * 3600);
  return Math.ceil(days * 10) / 10; // one decimal
}

export function plottedQueueMaxDays(): number {
  return Math.max(1, intEnv('PLOTTED_QUEUE_MAX_DAYS', 14));
}

export function isPlottedQueueOpen(orders: QueueOrder[], editionNext?: number, editionSize?: number): {
  open: boolean;
  reason: string | null;
  queueEtaDays: number;
  maxDays: number;
} {
  const eta = queueEtaDays(orders);
  const maxDays = plottedQueueMaxDays();
  if (editionNext != null && editionSize != null && editionNext > editionSize) {
    return {
      open: false,
      reason: `Edition sold out (${editionSize}/${editionSize})`,
      queueEtaDays: eta,
      maxDays,
    };
  }
  if (eta > maxDays) {
    return {
      open: false,
      reason: `Plot queue is ~${eta} days (limit ${maxDays}). Plotted originals are temporarily closed.`,
      queueEtaDays: eta,
      maxDays,
    };
  }
  return { open: true, reason: null, queueEtaDays: eta, maxDays };
}
