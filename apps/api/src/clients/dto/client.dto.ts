import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ClientType } from '@prisma/client';

export class CreateClientDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(50)
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsEnum(ClientType)
  clientType?: ClientType;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateClientDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  companyName?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsEmail()
  email?: string | null;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsEnum(ClientType)
  clientType?: ClientType;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
