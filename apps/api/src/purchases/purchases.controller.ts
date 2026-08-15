import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import type { User } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { ChangeStatusDto, UpsertPurchaseDto } from './dto/purchase.dto';
import { PurchasesService } from './purchases.service';

@Controller('purchases')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.OWNER)
export class PurchasesController {
  constructor(private readonly purchases: PurchasesService) {}

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
}
