import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import type { User } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { AccountingDocumentsService } from './accounting-documents.service';
import { AccountingReportsService } from './accounting-reports.service';
import { AccountingService } from './accounting.service';
import {
  CreateCargoPaymentDto,
  CreateCargoVendorDto,
  CreateOperatingExpenseDto,
  CreateOwnerWithdrawalDto,
  CreatePurchasePaymentDto,
} from './dto/accounting.dto';

@Controller('accounting')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.OWNER)
export class AccountingController {
  constructor(
    private readonly accounting: AccountingService,
    private readonly documents: AccountingDocumentsService,
    private readonly reports: AccountingReportsService,
  ) {}

  @Get('accounts')
  listAccounts() {
    return this.accounting.listAccounts();
  }

  @Get('company-accounts')
  @Roles(UserRole.OWNER, UserRole.WAREHOUSE)
  listCompanyAccounts() {
    return this.accounting.listCompanyPaymentAccounts();
  }

  @Get('journals')
  listJournals() {
    return this.accounting.listJournals();
  }

  @Get('journals/:id')
  getJournal(@Param('id') id: string) {
    return this.accounting.getJournal(id);
  }

  @Post('opening-capital')
  ensureOpeningCapital(@CurrentUser() user: User) {
    return this.accounting.ensureOpeningInvestorCapital(user.id);
  }

  @Get('supplier-payables')
  listSupplierPayables() {
    return this.documents.listSupplierPayables();
  }

  @Get('cargo-payables')
  listCargoPayables() {
    return this.documents.listCargoPayables();
  }

  @Get('receivables')
  listReceivables() {
    return this.documents.listOpenCustomerDebt();
  }

  @Get('cargo-vendors')
  listCargoVendors() {
    return this.documents.listCargoVendors();
  }

  @Post('cargo-vendors')
  createCargoVendor(@Body() dto: CreateCargoVendorDto) {
    return this.documents.createCargoVendor(dto);
  }

  @Post('purchases/:purchaseId/payments')
  payPurchase(
    @CurrentUser() user: User,
    @Param('purchaseId') purchaseId: string,
    @Body() dto: CreatePurchasePaymentDto,
  ) {
    return this.documents.recordPurchasePayment(user.id, purchaseId, dto);
  }

  @Post('purchase-payments/:id/cancel')
  cancelPurchasePayment(@CurrentUser() user: User, @Param('id') id: string) {
    return this.documents.cancelPurchasePayment(user.id, id);
  }

  @Post('cargo-payables/:id/payments')
  payCargo(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CreateCargoPaymentDto,
  ) {
    return this.documents.recordCargoPayment(user.id, id, dto);
  }

  @Post('cargo-payments/:id/cancel')
  cancelCargoPayment(@CurrentUser() user: User, @Param('id') id: string) {
    return this.documents.cancelCargoPayment(user.id, id);
  }

  @Get('operating-expenses')
  listExpenses() {
    return this.documents.listOperatingExpenses();
  }

  @Post('operating-expenses')
  createExpense(@CurrentUser() user: User, @Body() dto: CreateOperatingExpenseDto) {
    return this.documents.recordOperatingExpense(user.id, dto);
  }

  @Post('operating-expenses/:id/cancel')
  cancelExpense(@CurrentUser() user: User, @Param('id') id: string) {
    return this.documents.cancelOperatingExpense(user.id, id);
  }

  @Get('owner-withdrawals')
  listWithdrawals() {
    return this.documents.listOwnerWithdrawals();
  }

  @Post('owner-withdrawals')
  createWithdrawal(@CurrentUser() user: User, @Body() dto: CreateOwnerWithdrawalDto) {
    return this.documents.recordOwnerWithdrawal(user.id, dto);
  }

  @Post('owner-withdrawals/:id/cancel')
  cancelWithdrawal(@CurrentUser() user: User, @Param('id') id: string) {
    return this.documents.cancelOwnerWithdrawal(user.id, id);
  }

  @Get('dashboard')
  financeDashboard(
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.dashboard({
      preset: preset ?? (from && to ? 'custom' : 'month'),
      from,
      to,
    });
  }

  @Get('reports/cash-flow')
  cashFlow(
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: string,
  ) {
    return this.reports.cashFlow({
      preset: preset ?? (from && to ? 'custom' : 'month'),
      from,
      to,
      groupBy,
    });
  }

  @Get('reports/profit-loss')
  profitAndLoss(
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.profitAndLoss({
      preset: preset ?? (from && to ? 'custom' : 'month'),
      from,
      to,
    });
  }

  @Get('reports/balance-sheet')
  balanceSheet(
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.reports.balanceSheet({
      preset: preset ?? (from && to ? 'custom' : 'month'),
      from,
      to,
    });
  }

  @Get('reports/inventory-valuation')
  inventoryValuation() {
    return this.reports.inventoryValuation();
  }
}
