import { Module } from '@nestjs/common';
import { InventoryReconciliationService } from './inventory-reconciliation.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, InventoryReconciliationService],
})
export class ReportsModule {}
