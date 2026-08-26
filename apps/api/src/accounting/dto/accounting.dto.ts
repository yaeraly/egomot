import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { OperatingExpenseCategory } from '@prisma/client';

export class CreateOperatingExpenseDto {
  @IsDateString()
  expenseDate!: string;

  @IsEnum(OperatingExpenseCategory)
  category!: OperatingExpenseCategory;

  @IsString()
  amountKgs!: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsString()
  paymentAccountId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;
}

export class CreateOwnerWithdrawalDto {
  @IsDateString()
  withdrawnAt!: string;

  @IsString()
  amountKgs!: string;

  @IsString()
  paymentAccountId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class CreatePurchasePaymentDto {
  @IsString()
  amountKgs!: string;

  @IsString()
  paymentAccountId!: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateCargoPaymentDto {
  @IsString()
  amountKgs!: string;

  @IsString()
  paymentAccountId!: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateCargoVendorDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
