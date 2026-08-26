import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { memoryStorage } from 'multer';
import { SALES_OPERATOR_ROLES } from '../common/sales-access';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { ProductsService } from './products.service';

@Controller('products')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @Roles(...SALES_OPERATOR_ROLES)
  list(
    @Query('search') search?: string,
    @Query('active') active?: string,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.products.list(search, active, categoryId);
  }

  @Get(':id/purchase-price-history')
  @Roles(...SALES_OPERATOR_ROLES)
  purchasePriceHistory(@Param('id') id: string) {
    return this.products.listPurchasePriceHistory(id);
  }

  @Get(':id')
  @Roles(...SALES_OPERATOR_ROLES)
  get(@Param('id') id: string) {
    return this.products.get(id);
  }

  @Post()
  @Roles(UserRole.OWNER)
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER)
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.OWNER)
  remove(@Param('id') id: string) {
    return this.products.remove(id);
  }

  @Post(':id/deactivate')
  @Roles(UserRole.OWNER)
  deactivate(@Param('id') id: string) {
    return this.products.deactivate(id);
  }

  @Post(':id/image')
  @Roles(UserRole.OWNER)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadImage(@Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Файл изображения не загружен');
    }
    return this.products.saveImage(id, file);
  }

  @Delete(':id/image')
  @Roles(UserRole.OWNER)
  removeImage(@Param('id') id: string) {
    return this.products.removeImage(id);
  }
}
