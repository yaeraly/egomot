import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { ReportDateQueryDto } from './dto/report-date-query.dto';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.OWNER, UserRole.WAREHOUSE)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('purchases')
  purchaseReport(@Query() query: ReportDateQueryDto) {
    return this.run(() => this.reports.purchaseReport(query));
  }

  @Get('receipts')
  receiptReport(@Query() query: ReportDateQueryDto) {
    return this.run(() => this.reports.receiptReport(query));
  }

  @Get('inventory-movements')
  inventoryMovementReport(@Query() query: ReportDateQueryDto) {
    return this.run(() => this.reports.inventoryMovementReport(query));
  }

  @Get('sales')
  saleReport(@Query() query: ReportDateQueryDto) {
    return this.run(() => this.reports.saleReport(query));
  }

  @Get('missing-business-dates')
  missingBusinessDates() {
    return this.reports.missingBusinessDates();
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Error && error.message === 'REPORT_RANGE_REQUIRED') {
        throw new BadRequestException('Укажите период: preset или from/to');
      }
      throw error;
    }
  }
}
