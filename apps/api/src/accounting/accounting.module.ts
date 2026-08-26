import { Module } from '@nestjs/common';
import { AccountingDocumentsService } from './accounting-documents.service';
import { AccountingReportsService } from './accounting-reports.service';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';

@Module({
  controllers: [AccountingController],
  providers: [AccountingService, AccountingDocumentsService, AccountingReportsService],
  exports: [AccountingService, AccountingDocumentsService, AccountingReportsService],
})
export class AccountingModule {}
