import { Module } from '@nestjs/common';
import { FinanceBalanceService, FinanceSettingsService } from './finance-balance.service';
import { FinanceController } from './finance.controller';

@Module({
  controllers: [FinanceController],
  providers: [FinanceBalanceService, FinanceSettingsService],
  exports: [FinanceBalanceService, FinanceSettingsService],
})
export class FinanceModule {}
