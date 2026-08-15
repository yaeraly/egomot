import {
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@prisma/client';
import type { User } from '@prisma/client';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import {
  CalculatePriceDto,
  UpdateCategoryThresholdsDto,
  UpdateMarkupMatrixBodyDto,
} from './dto/pricing-settings.dto';
import { PricingSettingsService } from './pricing-settings.service';
import { PricingService } from './pricing.service';

@Controller('pricing')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.OWNER)
export class PricingController {
  constructor(
    private readonly pricing: PricingService,
    private readonly settings: PricingSettingsService,
  ) {}

  @Get('settings')
  getSettings() {
    return this.settings.getSettings();
  }

  @Patch('settings/thresholds')
  updateThresholds(
    @CurrentUser() user: User,
    @Body() dto: UpdateCategoryThresholdsDto,
  ) {
    return this.settings.updateThresholds(user, dto.thresholds);
  }

  @Patch('settings/markup-matrix')
  updateMarkupMatrix(
    @CurrentUser() user: User,
    @Body() dto: UpdateMarkupMatrixBodyDto,
  ) {
    return this.settings.updateMarkupMatrix(user, dto.items);
  }

  @Get('settings/audit-logs')
  auditLogs(@Query('limit') limit?: string) {
    return this.settings.auditLogs(limit ? Number(limit) : 50);
  }

  @Post('calculate')
  calculate(@Body() dto: CalculatePriceDto) {
    return this.pricing.calculatePrice(dto.productId, dto.clientId);
  }
}
