import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import type { User } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { LogisticsService } from '../accounting/logistics.service';
import { ChangeStatusDto, UpsertPurchaseDto } from './dto/purchase.dto';
import { PayPurchaseLogisticsDto, UpsertPurchaseLogisticsDto } from './dto/logistics.dto';
import { PurchasesService } from './purchases.service';

@Controller('purchases')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.OWNER)
export class PurchasesController {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly logistics: LogisticsService,
  ) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('supplierId') supplierId?: string,
    @Query('search') search?: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.purchases.list(status, supplierId, search, preset, from, to);
  }

  @Post('preview')
  preview(@Body() dto: UpsertPurchaseDto) {
    return this.purchases.preview(dto);
  }

  @Get(':id/audit-logs')
  auditLogs(@Param('id') id: string) {
    return this.purchases.auditLogs(id);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.purchases.get(id);
  }

  @Post()
  create(@CurrentUser() user: User, @Body() dto: UpsertPurchaseDto) {
    return this.purchases.create(user, dto);
  }

  @Patch(':id/status')
  changeStatus(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
  ) {
    return this.purchases.changeStatus(user, id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpsertPurchaseDto,
  ) {
    return this.purchases.update(user, id, dto);
  }

  @Post(':id/logistics')
  addLogistics(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpsertPurchaseLogisticsDto,
  ) {
    return this.logistics.create(user.id, id, dto);
  }

  @Patch(':id/logistics/:expenseId')
  updateLogistics(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('expenseId') expenseId: string,
    @Body() dto: UpsertPurchaseLogisticsDto,
  ) {
    return this.logistics.update(user.id, id, expenseId, dto);
  }

  @Post(':id/logistics/:expenseId/payments')
  payLogistics(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('expenseId') expenseId: string,
    @Body() dto: PayPurchaseLogisticsDto,
  ) {
    return this.logistics.pay(user.id, id, expenseId, dto);
  }

  @Post(':id/logistics-payments/:paymentId/cancel')
  cancelLogisticsPayment(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('paymentId') paymentId: string,
  ) {
    return this.logistics.cancelPayment(user.id, id, paymentId);
  }
}
