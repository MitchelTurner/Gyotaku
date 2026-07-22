import {
  Body,
  Controller,
  Headers,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CompleteUploadDto, PresignUploadDto } from './dto';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('presign')
  presign(@Body() body: PresignUploadDto) {
    return this.uploads.presign(body);
  }

  /** Browser uploads the file to the API; API writes to S3 (no direct browser→S3). */
  @Put(':id/content')
  async putContent(
    @Param('id') id: string,
    @Req() req: Request,
    @Headers('content-type') contentType?: string,
  ) {
    const buffer = await readRequestBuffer(req);
    return this.uploads.putContent(id, buffer, contentType || 'application/octet-stream');
  }

  @Post(':id/complete')
  complete(@Param('id') id: string, @Body() body: CompleteUploadDto) {
    return this.uploads.complete(id, body.sessionId);
  }
}

async function readRequestBuffer(req: Request): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
