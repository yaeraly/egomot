import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Currency, LogisticsType, PurchaseStatus } from '@prisma/client';

export class PurchaseItemInputDto {
  @IsUUID()
  productId!: string;

  @IsString()
  quantity!: string;

  @IsString()
  unitPriceCny!: string;

  @IsString()
  unitWeightKg!: string;
}

export class LogisticsInputDto {
  @IsEnum(LogisticsType)
  type!: LogisticsType;

  @IsString()
  amount!: string;

  @IsEnum(Currency)
  currency!: Currency;

  @IsOptional()
  @IsString()
  exchangeRate?: string | null;

  @IsOptional()
  @IsString()
  comment?: string | null;
}

export class UpsertPurchaseDto {
  @IsUUID()
  supplierId!: string;

  @IsDateString()
  purchaseDate!: string;

  @IsString()
  exchangeRateCnyToKgs!: string;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemInputDto)
  items!: PurchaseItemInputDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LogisticsInputDto)
  logistics!: LogisticsInputDto[];
}

export class ChangeStatusDto {
  @IsEnum(PurchaseStatus)
  status!: PurchaseStatus;
}
