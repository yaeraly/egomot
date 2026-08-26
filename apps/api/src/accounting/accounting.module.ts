import { Module } from '@nestjs/common';
import { AccountingDocumentsService } from './accounting-documents.service';
import { AccountingController } from './accounting.controller';
import { AccountingService } from './accounting.service';

@Module({
  controllers: [AccountingController],
  providers: [AccountingService, AccountingDocumentsService],
  exports: [AccountingService, AccountingDocumentsService],
})
export class AccountingModule {}
