import {
  isPlottedQueueOpen,
  outstandingPlotSeconds,
  queueEtaDays,
} from './queue-eta';

describe('queue-eta', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it('sums plot seconds for PAID/PLOTTING only', () => {
    process.env.PLOTTED_ORDER_OVERHEAD_SECONDS = '0';
    const sec = outstandingPlotSeconds([
      { status: 'PAID', estPlotSeconds: 3600 },
      { status: 'PLOTTING', estPlotSeconds: 1800 },
      { status: 'PACKED', estPlotSeconds: 9999 },
      { status: 'SHIPPED', estPlotSeconds: 9999 },
    ]);
    expect(sec).toBe(5400);
  });

  it('converts seconds to days using plot hours/day', () => {
    process.env.PLOTTED_ORDER_OVERHEAD_SECONDS = '0';
    process.env.PLOTTED_PLOT_HOURS_PER_DAY = '4';
    // 8 hours of plot work → 2 days
    const days = queueEtaDays([{ status: 'PAID', estPlotSeconds: 8 * 3600 }]);
    expect(days).toBe(2);
  });

  it('closes when ETA exceeds max days', () => {
    process.env.PLOTTED_ORDER_OVERHEAD_SECONDS = '0';
    process.env.PLOTTED_PLOT_HOURS_PER_DAY = '4';
    process.env.PLOTTED_QUEUE_MAX_DAYS = '3';
    const result = isPlottedQueueOpen([
      { status: 'PAID', estPlotSeconds: 20 * 3600 }, // 5 days
    ]);
    expect(result.open).toBe(false);
    expect(result.queueEtaDays).toBeGreaterThan(3);
  });

  it('closes when edition is sold out', () => {
    process.env.PLOTTED_QUEUE_MAX_DAYS = '30';
    const result = isPlottedQueueOpen([], 26, 25);
    expect(result.open).toBe(false);
    expect(result.reason).toMatch(/sold out/i);
  });
});
