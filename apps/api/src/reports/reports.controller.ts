import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { InventoryReconciliationQueryDto } from './dto/inventory-reconciliation-query.dto';
import { ReportDateQueryDto } from './dto/report-date-query.dto';
import { InventoryReconciliationService } from './inventory-reconciliation.service';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.OWNER, UserRole.WAREHOUSE)
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly reconciliation: InventoryReconciliationService,
  ) {}

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

  @Get('inventory-reconciliation')
  inventoryReconciliation(@Query() query: InventoryReconciliationQueryDto) {
    return this.reconciliation.inventoryReconciliation(query);
  }

  @Get('sales-vs-purchases')
  salesVsPurchases(@Query() query: InventoryReconciliationQueryDto) {
    return this.reconciliation.salesVsPurchasesReport(query);
  }

  @Get('negative-stock')
  negativeStock(@Query() query: InventoryReconciliationQueryDto) {
    return this.reconciliation.negativeStockReport(query);
  }

  @Get('stock-movements')
  stockMovements(@Query() query: InventoryReconciliationQueryDto) {
    return this.reconciliation.stockMovementLedger(query);
  }

  @Get('inventory-reconciliation/:productId/movements')
  productMovementHistory(@Param('productId') productId: string) {
    return this.reconciliation.productMovementHistory(productId);
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
