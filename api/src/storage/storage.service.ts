import { Injectable } from '@nestjs/common';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  readonly bucket: string;
  private readonly publicUrl: string;
  /** Host the browser must reach (rewrites localhost/internal signed URLs). */
  private readonly browserEndpoint: string | null;

  constructor() {
    this.bucket = process.env.S3_BUCKET || 'gyotaku';
    this.publicUrl = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');
    const endpoint = process.env.S3_ENDPOINT;
    this.browserEndpoint = (
      process.env.S3_BROWSER_ENDPOINT ||
      process.env.S3_PUBLIC_ENDPOINT ||
      ''
    ).replace(/\/$/, '') || null;
    this.client = new S3Client({
      region: process.env.S3_REGION || 'us-east-1',
      endpoint: endpoint || undefined,
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || 'true') === 'true',
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || 'minio',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'minio12345',
      },
    });

    if (endpoint && /localhost|127\.0\.0\.1/.test(endpoint)) {
      // eslint-disable-next-line no-console
      console.warn(
        `[storage] S3_ENDPOINT=${endpoint} — browsers cannot upload to localhost. ` +
          `Set a public S3/R2/MinIO endpoint (and optional S3_BROWSER_ENDPOINT).`,
      );
    }
  }

  /** Rewrite signed URL host so the browser can reach storage. */
  private forBrowser(signedUrl: string): string {
    if (!this.browserEndpoint) return signedUrl;
    try {
      const signed = new URL(signedUrl);
      const browser = new URL(this.browserEndpoint);
      signed.protocol = browser.protocol;
      signed.host = browser.host;
      return signed.toString();
    } catch {
      return signedUrl;
    }
  }

  async presignPut(key: string, contentType: string, expiresIn = 900) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn });
    return this.forBrowser(url);
  }

  async presignGet(key: string, expiresIn = 3600) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn });
    return this.forBrowser(url);
  }

  async head(key: string) {
    return this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    const body = res.Body;
    if (!body) return Buffer.alloc(0);
    if (body instanceof Readable || typeof (body as any).pipe === 'function') {
      const chunks: Buffer[] = [];
      for await (const chunk of body as AsyncIterable<Buffer>) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
    // SDK v3 may return a web ReadableStream / Uint8Array in some runtimes
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }

  publicUrlFor(key: string): string | null {
    if (!this.publicUrl) return null;
    return `${this.publicUrl}/${key}`;
  }
}
