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

export class CreateSaleDto {
  @IsString()
  clientId!: string;

  @IsDateString()
  saleDate!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleItemDto)
  items!: CreateSaleItemDto[];
}

export class AddPaymentDto {
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
