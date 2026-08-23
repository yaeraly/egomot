import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ReportDateQueryDto } from './report-date-query.dto';

export class InventoryReconciliationQueryDto extends ReportDateQueryDto {
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;
}
