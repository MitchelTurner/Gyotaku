import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class CreateRenditionDto {
  @IsString()
  uploadId!: string;

  @IsOptional()
  @IsObject()
  styleParams?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  seed?: number;

  /** Echoed for rate limiting; should match the upload's session. */
  @IsString()
  sessionId!: string;
}
