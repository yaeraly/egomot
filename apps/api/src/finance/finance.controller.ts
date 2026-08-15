import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { User } from '@prisma/client';
import { SALES_OPERATOR_ROLES } from '../common/sales-access';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import {
  FinanceBalanceService,
  FinanceSettingsService,
} from './finance-balance.service';

@Controller('finance')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(...SALES_OPERATOR_ROLES)
export class FinanceController {
  constructor(
    private readonly finance: FinanceBalanceService,
    private readonly financeSettings: FinanceSettingsService,
  ) {}

  @Get('payment-methods')
  listPaymentMethods() {
    return this.finance.listPaymentMethods();
  }

  @Get('my-accounts')
  async myAccounts(@CurrentUser() user: User) {
    await this.financeSettings.ensureUserAccounts(user.id, user.name);
    return this.finance.listUserPaymentAccounts(user.id);
  }

  @Get('my-balance')
  async myBalance(@CurrentUser() user: User) {
    await this.financeSettings.ensureUserAccounts(user.id, user.name);
    return this.finance.getEmployeeBalance(user.id);
  }
}
