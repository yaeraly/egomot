import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { InventoryService } from './inventory.service';

@Controller('inventory')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.OWNER, UserRole.WAREHOUSE)
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  listStock(@Query('search') search?: string) {
    return this.inventory.listStock(search);
  }

  @Get('movements')
  listMovements(
    @Query('productId') productId?: string,
    @Query('referenceId') referenceId?: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.inventory.listMovements(productId, referenceId, preset, from, to);
  }
}
