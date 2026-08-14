import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateProductDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsString()
  @MinLength(1)
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
  @IsString()
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
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isActive?: boolean;
}

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}
