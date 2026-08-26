import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumberString,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class ReceiptItemDto {
  @IsUUID()
  productId!: string;

  @IsNumberString()
  receivedQuantity!: string;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class ReceiptTransportDto {
  @IsOptional()
  @IsNumberString()
  chinaInternalTransportKgs?: string;

  @IsOptional()
  @IsNumberString()
  cargoKgs?: string;

  @IsOptional()
  @IsNumberString()
  kyrgyzstanInternalTransportKgs?: string;
}

export class CreatePurchaseReceiptDto {
  @IsDateString()
  warehouseReceiptDate!: string;

  @IsOptional()
  @IsString()
  comment?: string;
}

export class UpdatePurchaseReceiptDto {
  @IsOptional()
  @IsDateString()
  warehouseReceiptDate?: string;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ReceiptTransportDto)
  transport?: ReceiptTransportDto;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemDto)
  items?: ReceiptItemDto[];
}

export class CompletePurchaseReceiptDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceiptItemCommentDto)
  discrepancyComments?: ReceiptItemCommentDto[];

  @IsOptional()
  @IsNumberString()
  supplierPaidKgs?: string;

  @IsOptional()
  @IsUUID()
  paymentAccountId?: string;
}

export class ReceiptItemCommentDto {
  @IsUUID()
  productId!: string;

  @IsOptional()
  @IsString()
  comment?: string;
}
