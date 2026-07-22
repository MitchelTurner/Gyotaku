import { PYTHON_JOB_QUEUE } from '../queue/queue.constants';

export { PYTHON_JOB_QUEUE };

export type PrintJobPayload = {
  type: 'print';
  renditionId: string;
  uploadId: string;
  s3Key: string;
  styleParams: Record<string, unknown>;
  seed: number;
  imageHash: string;
};
