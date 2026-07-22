export const RENDITION_QUEUE = 'renditions';
export const RENDITION_JOB = 'generate';

/** Redis list consumed by the Python generator worker. */
export const PYTHON_JOB_QUEUE = 'gyotaku:jobs';
/** Failed generate/print jobs for operator retry inspection. */
export const PYTHON_DEADLETTER_QUEUE = 'gyotaku:deadletter';
/** Recent generate latencies (ms) — Redis list, newest first. */
export const METRICS_LATENCY_KEY = 'gyotaku:metrics:latency';
