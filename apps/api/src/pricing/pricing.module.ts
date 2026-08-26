import { Module } from '@nestjs/common';
import { ClientCategoryService } from './client-category.service';
import { PricingController } from './pricing.controller';
import { PricingSettingsService } from './pricing-settings.service';
import { PricingService } from './pricing.service';

@Module({
  controllers: [PricingController],
  providers: [PricingService, PricingSettingsService, ClientCategoryService],
  exports: [PricingService, PricingSettingsService, ClientCategoryService],
})
export class PricingModule {}
