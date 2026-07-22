import { ProductType } from '@prisma/client';
import {
  IsBoolean,
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

  /** Captain referral code from QR (?ref=) */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  affiliateCode?: string;
}

export class CreateAffiliateDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  code?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  boatName?: string;

  /** Basis points — 1000 = 10%. Default from AFFILIATE_DEFAULT_COMMISSION_BPS. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5000)
  commissionBps?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class MarkAffiliatePaidDto {
  @IsOptional()
  @IsString({ each: true })
  orderIds?: string[];
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
