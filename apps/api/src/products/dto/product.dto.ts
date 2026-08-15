import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsUUID()
  categoryId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unit!: string;

  @IsString()
  unitWeightKg!: string;

  @IsOptional()
  @IsString()
  defaultPurchasePriceCny?: string | null;

  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined || value === '' ? null : String(value),
  )
  @IsString()
  baseMarkupPercent?: string | null;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  unit?: string;

  @IsOptional()
  @IsString()
  unitWeightKg?: string;

  @IsOptional()
  @IsString()
  defaultPurchasePriceCny?: string | null;

  @IsOptional()
  @Transform(({ value }) =>
    value === null || value === undefined || value === '' ? null : String(value),
  )
  @IsString()
  baseMarkupPercent?: string | null;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isActive?: boolean;
}
