import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import { SALES_OPERATOR_ROLES } from '../common/sales-access';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { ClientsService } from './clients.service';
import { CreateClientDto, UpdateClientDto } from './dto/client.dto';

@Controller('clients')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @Roles(...SALES_OPERATOR_ROLES)
  list(@Query('search') search?: string, @Query('active') active?: string) {
    return this.clients.list(search, active);
  }

  @Get(':id/debt')
  @Roles(...SALES_OPERATOR_ROLES)
  debt(@Param('id') id: string) {
    return this.clients.getDebt(id);
  }

  @Get(':id/card')
  @Roles(...SALES_OPERATOR_ROLES)
  card(@Param('id') id: string) {
    return this.clients.getCard(id);
  }

  @Get(':id')
  @Roles(...SALES_OPERATOR_ROLES)
  get(@Param('id') id: string) {
    return this.clients.get(id);
  }

  @Post()
  @Roles(UserRole.OWNER)
  create(@Body() dto: CreateClientDto) {
    return this.clients.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER)
  update(@Param('id') id: string, @Body() dto: UpdateClientDto) {
    return this.clients.update(id, dto);
  }
}
