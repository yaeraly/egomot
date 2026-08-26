import { Module } from '@nestjs/common';
import { FinanceAccountsService } from './finance-accounts.service';
import { FinanceBalanceService, FinanceSettingsService } from './finance-balance.service';
import { FinanceController } from './finance.controller';

@Module({
  controllers: [FinanceController],
  providers: [FinanceBalanceService, FinanceSettingsService, FinanceAccountsService],
  exports: [FinanceBalanceService, FinanceSettingsService, FinanceAccountsService],
})
export class FinanceModule {}
