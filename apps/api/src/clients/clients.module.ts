import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { SalesModule } from '../sales/sales.module';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';

@Module({
  imports: [PricingModule, SalesModule],
  controllers: [ClientsController],
  providers: [ClientsService],
  exports: [ClientsService],
})
export class ClientsModule {}
