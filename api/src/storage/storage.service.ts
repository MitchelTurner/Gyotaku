import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
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
  private readonly endpoint: string;
  /** Host the browser must reach (rewrites localhost/internal signed URLs). */
  private readonly browserEndpoint: string | null;

  constructor() {
    this.bucket = process.env.S3_BUCKET || 'gyotaku';
    this.publicUrl = (process.env.S3_PUBLIC_URL || '').replace(/\/$/, '');
    this.endpoint = process.env.S3_ENDPOINT || '';
    this.browserEndpoint =
      (
        process.env.S3_BROWSER_ENDPOINT ||
        process.env.S3_PUBLIC_ENDPOINT ||
        ''
      ).replace(/\/$/, '') || null;
    const isR2 = this.endpoint.includes('r2.cloudflarestorage.com');
    const region = process.env.S3_REGION || (isR2 ? 'auto' : 'us-east-1');
    const forcePathStyle =
      process.env.S3_FORCE_PATH_STYLE !== undefined
        ? process.env.S3_FORCE_PATH_STYLE === 'true'
        : !isR2;
    this.client = new S3Client({
      region,
      endpoint: this.endpoint || undefined,
      forcePathStyle,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || 'minio',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'minio12345',
      },
    });

    if (this.isLocalEndpoint()) {
      // eslint-disable-next-line no-console
      console.warn(
        `[storage] S3_ENDPOINT=${this.endpoint || '(default aws)'} looks local. ` +
          `On Railway, set S3_* to a real bucket (R2/S3/MinIO).`,
      );
    }
  }

  isLocalEndpoint(): boolean {
    if (!this.endpoint) return false;
    return /localhost|127\.0\.0\.1/.test(this.endpoint);
  }

  /** Fail early with a browser-visible message when storage can't work on Railway. */
  assertReachableFromServer(): void {
    if (this.isLocalEndpoint() && process.env.RAILWAY_ENVIRONMENT) {
      throw new ServiceUnavailableException(
        'Storage misconfigured: S3_ENDPOINT points to localhost. ' +
          'On the API (and worker) set S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / ' +
          'S3_SECRET_ACCESS_KEY to a real public or Railway-private bucket ' +
          '(Cloudflare R2, AWS S3, or MinIO).',
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

  async putObject(key: string, body: Buffer, contentType: string) {
    this.assertReachableFromServer();
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async presignPut(key: string, contentType: string, expiresIn = 900) {
    this.assertReachableFromServer();
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn });
    return this.forBrowser(url);
  }

  async presignGet(key: string, expiresIn = 3600) {
    this.assertReachableFromServer();
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn });
    return this.forBrowser(url);
  }

  async head(key: string) {
    this.assertReachableFromServer();
    return this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  async getObjectBuffer(key: string): Promise<Buffer> {
    this.assertReachableFromServer();
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
    const bytes = await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
    return Buffer.from(bytes);
  }

  publicUrlFor(key: string): string | null {
    if (!this.publicUrl) return null;
    return `${this.publicUrl}/${key}`;
  }

  configSummary() {
    return {
      bucket: this.bucket,
      endpoint: this.endpoint || null,
      localEndpoint: this.isLocalEndpoint(),
      browserEndpoint: this.browserEndpoint,
    };
  }
}
