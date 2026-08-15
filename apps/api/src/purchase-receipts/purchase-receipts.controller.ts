import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import type { User } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import {
  CompletePurchaseReceiptDto,
  CreatePurchaseReceiptDto,
  UpdatePurchaseReceiptDto,
} from './dto/purchase-receipt.dto';
import { PurchaseReceiptsService } from './purchase-receipts.service';

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.OWNER, UserRole.WAREHOUSE)
export class PurchaseReceiptsController {
  constructor(private readonly receipts: PurchaseReceiptsService) {}

  @Post('purchases/:purchaseId/receipts')
  create(
    @CurrentUser() user: User,
    @Param('purchaseId') purchaseId: string,
    @Body() dto: CreatePurchaseReceiptDto,
  ) {
    return this.receipts.create(user, purchaseId, dto);
  }

  @Get('purchase-receipts')
  list(
    @Query('status') status?: string,
    @Query('purchaseId') purchaseId?: string,
    @Query('search') search?: string,
  ) {
    return this.receipts.list(status, purchaseId, search);
  }

  @Get('purchase-receipts/:id')
  get(@Param('id') id: string) {
    return this.receipts.get(id);
  }

  @Patch('purchase-receipts/:id')
  update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseReceiptDto,
  ) {
    return this.receipts.update(user, id, dto);
  }

  @Post('purchase-receipts/:id/calculate')
  calculate(@Param('id') id: string) {
    return this.receipts.calculate(id);
  }

  @Post('purchase-receipts/:id/complete')
  complete(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: CompletePurchaseReceiptDto,
  ) {
    return this.receipts.complete(user, id, dto);
  }

  @Post('purchase-receipts/:id/cancel')
  cancel(@CurrentUser() user: User, @Param('id') id: string) {
    return this.receipts.cancel(user, id);
  }
}
