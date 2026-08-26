import {
  IsDateString,
  IsOptional,
  IsString,
} from 'class-validator';

export class ReportDateQueryDto {
  @IsOptional()
  @IsString()
  preset?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
