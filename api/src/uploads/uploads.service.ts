import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { SessionService } from '../session/session.service';
import { StorageService } from '../storage/storage.service';
import { PresignUploadDto } from './dto';

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly sessions: SessionService,
  ) {}

  async presign(dto: PresignUploadDto) {
    if (!ALLOWED_TYPES.has(dto.contentType)) {
      throw new BadRequestException(
        `Unsupported content type: ${dto.contentType}`,
      );
    }
    await this.sessions.assertUploadAllowance(dto.sessionId);

    const ext = extensionFor(dto.contentType, dto.filename);
    const upload = await this.prisma.upload.create({
      data: {
        sessionId: dto.sessionId,
        s3Key: 'pending',
      },
    });
    const key = `uploads/${dto.sessionId}/${upload.id}.${ext}`;
    await this.prisma.upload.update({
      where: { id: upload.id },
      data: { s3Key: key },
    });

    const uploadUrl = await this.storage.presignPut(key, dto.contentType);
    return {
      uploadId: upload.id,
      uploadUrl,
      s3Key: key,
      expiresInSeconds: 900,
    };
  }

  async complete(uploadId: string, sessionId?: string) {
    const upload = await this.prisma.upload.findUnique({
      where: { id: uploadId },
    });
    if (!upload) throw new NotFoundException('Upload not found');
    if (sessionId && upload.sessionId !== sessionId) {
      throw new BadRequestException('sessionId does not match upload');
    }

    try {
      await this.storage.head(upload.s3Key);
    } catch {
      throw new BadRequestException(
        'Object not found in storage — upload the file to the presigned URL first',
      );
    }

    const buf = await this.storage.getObjectBuffer(upload.s3Key);
    if (buf.length > 25 * 1024 * 1024) {
      throw new BadRequestException('Image exceeds 25 MB limit');
    }

    let meta: sharp.Metadata;
    try {
      meta = await sharp(buf).rotate().metadata();
    } catch {
      throw new BadRequestException('Could not decode image');
    }
    const width = meta.width || 0;
    const height = meta.height || 0;
    if (Math.min(width, height) < 600) {
      throw new BadRequestException(
        `Image too small: short edge is ${Math.min(width, height)}px (minimum 600px)`,
      );
    }

    const imageHash = createHash('sha256').update(buf).digest('hex');

    const updated = await this.prisma.upload.update({
      where: { id: uploadId },
      data: { width, height, imageHash },
    });

    return {
      id: updated.id,
      sessionId: updated.sessionId,
      s3Key: updated.s3Key,
      imageHash: updated.imageHash,
      width: updated.width,
      height: updated.height,
    };
  }
}

function extensionFor(contentType: string, filename: string): string {
  const fromName = filename.split('.').pop()?.toLowerCase();
  if (fromName && ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(fromName)) {
    return fromName === 'jpeg' ? 'jpg' : fromName;
  }
  switch (contentType) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
    case 'image/heif':
      return 'heic';
    default:
      return 'jpg';
  }
}
