import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class PresignUploadDto {
  @IsString()
  sessionId!: string;

  @IsString()
  filename!: string;

  @IsString()
  contentType!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(25 * 1024 * 1024)
  contentLength?: number;
}

export class CompleteUploadDto {
  @IsOptional()
  @IsString()
  sessionId?: string;
}
