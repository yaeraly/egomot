import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module';
import { PurchaseReceiptsController } from './purchase-receipts.controller';
import { PurchaseReceiptsService } from './purchase-receipts.service';

@Module({
  imports: [AccountingModule],
  controllers: [PurchaseReceiptsController],
  providers: [PurchaseReceiptsService],
})
export class PurchaseReceiptsModule {}
