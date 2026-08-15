import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { User } from '@prisma/client';
import { UserRole } from '@prisma/client';
import { SALES_OPERATOR_ROLES } from '../common/sales-access';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import {
  ConfirmSaleDto,
  CreateSaleReturnDto,
  PayDebtDto,
  PreviewSaleDto,
} from './dto/sale.dto';
import { SalesService } from './sales.service';

@Controller('sales')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(...SALES_OPERATOR_ROLES)
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get()
  list(@Query('search') search?: string, @Query('clientId') clientId?: string) {
    return this.sales.list(search, clientId);
  }

  @Post('preview')
  preview(@Body() dto: PreviewSaleDto) {
    return this.sales.preview(dto);
  }

  @Post('confirm')
  confirm(@CurrentUser() user: User, @Body() dto: ConfirmSaleDto) {
    return this.sales.confirm(user, dto);
  }

  @Get(':id/receipt')
  receipt(@Param('id') id: string) {
    return this.sales.getReceipt(id);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.sales.get(id);
  }

  @Post(':id/debt-payments')
  payDebt(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() dto: PayDebtDto,
  ) {
    return this.sales.payDebt(user, id, dto);
  }

  @Post(':id/returns')
  @Roles(UserRole.OWNER)
  createReturn(@Param('id') id: string, @Body() dto: CreateSaleReturnDto) {
    return this.sales.createReturn(id, dto);
  }
}
