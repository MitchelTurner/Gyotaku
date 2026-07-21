import { Body, Controller, Param, Post } from '@nestjs/common';
import { CompleteUploadDto, PresignUploadDto } from './dto';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post('presign')
  presign(@Body() body: PresignUploadDto) {
    return this.uploads.presign(body);
  }

  @Post(':id/complete')
  complete(@Param('id') id: string, @Body() body: CompleteUploadDto) {
    return this.uploads.complete(id, body.sessionId);
  }
}
