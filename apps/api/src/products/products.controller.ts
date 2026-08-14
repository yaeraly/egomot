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
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { CreateCategoryDto, CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { ProductsService } from './products.service';

@Controller()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(UserRole.OWNER)
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get('products')
  list(@Query('search') search?: string, @Query('active') active?: string) {
    return this.products.list(search, active);
  }

  @Get('products/:id')
  get(@Param('id') id: string) {
    return this.products.get(id);
  }

  @Post('products')
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Patch('products/:id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto);
  }

  @Post('products/:id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.products.deactivate(id);
  }

  @Post('products/:id/image')
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

  @Delete('products/:id/image')
  removeImage(@Param('id') id: string) {
    return this.products.removeImage(id);
  }

  @Get('product-categories')
  categories() {
    return this.products.listCategories();
  }

  @Post('product-categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.products.createCategory(dto);
  }
}
