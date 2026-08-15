import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import {
  AddPaymentDto,
  CreateSaleDto,
  CreateSaleReturnDto,
} from './dto/sale.dto';
import { SalesService } from './sales.service';

@Controller('sales')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.OWNER)
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get(':id')
  get(@Param('id') id: string) {
    return this.sales.get(id);
  }

  @Post()
  create(@Body() dto: CreateSaleDto) {
    return this.sales.create(dto);
  }

  @Post(':id/payments')
  addPayment(@Param('id') id: string, @Body() dto: AddPaymentDto) {
    return this.sales.addPayment(id, dto);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.sales.cancel(id);
  }

  @Post(':id/returns')
  createReturn(@Param('id') id: string, @Body() dto: CreateSaleReturnDto) {
    return this.sales.createReturn(id, dto);
  }
}
