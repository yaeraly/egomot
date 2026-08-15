import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class CreateSaleItemDto {
  @IsString()
  productId!: string;

  @IsString()
  quantity!: string;
}

export class PreviewSaleDto {
  @IsString()
  clientId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleItemDto)
  items!: CreateSaleItemDto[];
}

export class SalePaymentEntryDto {
  @IsString()
  paymentAccountId!: string;

  @IsString()
  amountKgs!: string;
}

export class ConfirmSaleDto {
  @IsString()
  clientId!: string;

  @IsOptional()
  @IsDateString()
  saleDate?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleItemDto)
  items!: CreateSaleItemDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalePaymentEntryDto)
  payments!: SalePaymentEntryDto[];

  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class UpdateSaleDateDto {
  @IsDateString()
  saleDate!: string;
}

export class UpdateSaleItemPriceDto {
  @IsString()
  unitPriceKgs!: string;
}

export class PayDebtDto {
  @IsString()
  paymentAccountId!: string;

  @IsString()
  amountKgs!: string;

  @IsOptional()
  @IsDateString()
  paidAt?: string;
}

export class CreateSaleReturnItemDto {
  @IsString()
  productId!: string;

  @IsString()
  quantity!: string;

  @IsString()
  refundAmountKgs!: string;
}

export class CreateSaleReturnDto {
  @IsDateString()
  returnDate!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleReturnItemDto)
  items!: CreateSaleReturnItemDto[];
}
