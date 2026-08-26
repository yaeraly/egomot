import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { Currency, LogisticsType } from '@prisma/client';

export class UpsertPurchaseLogisticsDto {
  @IsEnum(LogisticsType)
  type!: LogisticsType;

  @IsDateString()
  expenseDate!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  payeeName?: string | null;

  @IsString()
  amount!: string;

  @IsEnum(Currency)
  currency!: Currency;

  @IsOptional()
  @IsString()
  exchangeRate?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string | null;

  @IsIn(['PAID', 'PARTIAL', 'UNPAID'])
  settlement!: 'PAID' | 'PARTIAL' | 'UNPAID';

  @IsOptional()
  @IsString()
  paidAmountKgs?: string | null;

  @IsOptional()
  @IsUUID()
  paymentAccountId?: string | null;

  @IsOptional()
  @IsDateString()
  paidAt?: string | null;
}

export class PayPurchaseLogisticsDto {
  @IsString()
  amountKgs!: string;

  @IsUUID()
  paymentAccountId!: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
