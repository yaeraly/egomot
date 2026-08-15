import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ClientPricingCategory, ClientType } from '@prisma/client';

export class UpdateCategoryThresholdDto {
  @IsEnum(ClientPricingCategory)
  category!: ClientPricingCategory;

  @IsOptional()
  @IsString()
  minPaidAmountKgs?: string;

  @IsOptional()
  @IsString()
  maxPaidAmountKgs?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCategoryThresholdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateCategoryThresholdDto)
  thresholds!: UpdateCategoryThresholdDto[];
}

export class UpdateMarkupMatrixItemDto {
  @IsEnum(ClientType)
  clientType!: ClientType;

  @IsEnum(ClientPricingCategory)
  category!: ClientPricingCategory;

  @IsString()
  markupPercent!: string;
}

export class UpdateMarkupMatrixDto {
  @IsEnum(ClientType)
  clientType!: ClientType;

  @IsEnum(ClientPricingCategory)
  category!: ClientPricingCategory;

  @IsString()
  markupPercent!: string;
}

export class UpdateMarkupMatrixBodyDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateMarkupMatrixItemDto)
  items!: UpdateMarkupMatrixItemDto[];
}

export class CalculatePriceDto {
  @IsString()
  productId!: string;

  @IsString()
  clientId!: string;
}
