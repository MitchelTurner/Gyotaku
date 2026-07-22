import { ProductType } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
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
