import { ProductType } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCheckoutDto {
  @IsString()
  @MinLength(8)
  sessionId!: string;

  @IsString()
  @MinLength(8)
  renditionId!: string;

  @IsEnum(ProductType)
  productType!: ProductType;

  /** Optional override; otherwise taken from rendition.styleParams.fish_length_in */
  @IsOptional()
  @IsNumber()
  @Min(4)
  @Max(60)
  fishLengthIn?: number;

  @IsOptional()
  @IsEmail()
  email?: string;

  /** Optional gift packaging note (max 200 chars). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  giftNote?: string;
}

export class JoinWaitlistDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  renditionId?: string;

  @IsOptional()
  @IsNumber()
  @Min(4)
  @Max(60)
  fishLengthIn?: number;

  @IsOptional()
  @IsEnum(ProductType)
  productType?: ProductType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class UpdateFulfillmentDto {
  @IsIn(['PAID', 'PLOTTING', 'PRINTING', 'PACKED', 'SHIPPED', 'CANCELLED'])
  status!: 'PAID' | 'PLOTTING' | 'PRINTING' | 'PACKED' | 'SHIPPED' | 'CANCELLED';

  @IsOptional()
  @IsString()
  trackingNumber?: string;

  @IsOptional()
  @IsString()
  fulfillmentNote?: string;
}
