import { Module } from '@nestjs/common';
import { FinanceModule } from '../finance/finance.module';
import { PricingModule } from '../pricing/pricing.module';
import { ClientDebtService } from './client-debt.service';
import { SaleReceiptService, WhatsAppService } from './sale-receipt.service';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';

@Module({
  imports: [PricingModule, FinanceModule],
  controllers: [SalesController],
  providers: [
    SalesService,
    ClientDebtService,
    SaleReceiptService,
    WhatsAppService,
  ],
  exports: [SalesService, ClientDebtService],
})
export class SalesModule {}
