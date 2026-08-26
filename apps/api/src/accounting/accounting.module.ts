import { Module } from '@nestjs/common';
import { AccountingDocumentsService } from './accounting-documents.service';
import { AccountingReportsService } from './accounting-reports.service';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';
import { LogisticsService } from './logistics.service';
import { PayableSyncService } from './payable-sync.service';

@Module({
  controllers: [AccountingController],
  providers: [
    AccountingService,
    AccountingDocumentsService,
    AccountingReportsService,
    LogisticsService,
    PayableSyncService,
  ],
  exports: [
    AccountingService,
    AccountingDocumentsService,
    AccountingReportsService,
    LogisticsService,
    PayableSyncService,
  ],
})
export class AccountingModule {}
