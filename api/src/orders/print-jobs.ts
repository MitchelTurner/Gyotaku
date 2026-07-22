/** Redis list payload for on-demand 300 DPI print generation (giclée). */

export const PYTHON_JOB_QUEUE = 'gyotaku:jobs';

export type PrintJobPayload = {
  type: 'print';
  renditionId: string;
  uploadId: string;
  s3Key: string;
  styleParams: Record<string, unknown>;
  seed: number;
  imageHash: string;
};
