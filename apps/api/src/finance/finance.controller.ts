import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { User } from '@prisma/client';
import { UserRole } from '@prisma/client';
import { SALES_OPERATOR_ROLES } from '../common/sales-access';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import {
  FinanceBalanceService,
  FinanceSettingsService,
} from './finance-balance.service';
import { FinanceAccountsService } from './finance-accounts.service';
import {
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
} from './dto/payment-method.dto';

@Controller('finance')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class FinanceController {
  constructor(
    private readonly finance: FinanceBalanceService,
    private readonly financeSettings: FinanceSettingsService,
    private readonly financeAccounts: FinanceAccountsService,
  ) {}

  @Get('accounts')
  @Roles(UserRole.OWNER)
  listAccounts(@Query('active') active?: string) {
    return this.financeAccounts.list(active);
  }

  @Post('accounts')
  @Roles(UserRole.OWNER)
  createAccount(@Body() dto: CreatePaymentMethodDto) {
    return this.financeAccounts.create(dto);
  }

  @Get('accounts/:id')
  @Roles(UserRole.OWNER)
  getAccount(@Param('id') id: string) {
    return this.financeAccounts.get(id);
  }

  @Patch('accounts/:id')
  @Roles(UserRole.OWNER)
  updateAccount(@Param('id') id: string, @Body() dto: UpdatePaymentMethodDto) {
    return this.financeAccounts.update(id, dto);
  }

  @Get('payment-methods')
  @Roles(...SALES_OPERATOR_ROLES)
  listPaymentMethods() {
    return this.finance.listPaymentMethods();
  }

  @Get('my-accounts')
  @Roles(...SALES_OPERATOR_ROLES)
  async myAccounts(@CurrentUser() user: User) {
    await this.financeSettings.ensureUserAccounts(user.id, user.name);
    return this.finance.listUserPaymentAccounts(user.id);
  }

  @Get('my-balance')
  @Roles(...SALES_OPERATOR_ROLES)
  async myBalance(@CurrentUser() user: User) {
    await this.financeSettings.ensureUserAccounts(user.id, user.name);
    return this.finance.getEmployeeBalance(user.id);
  }
}
