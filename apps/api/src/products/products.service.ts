import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createWriteStream, mkdirSync, existsSync, unlinkSync } from 'fs';
import { extname, join } from 'path';
import { pipeline } from 'stream/promises';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCategoryDto, CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { publicDecimal } from '../common/decimal.util';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(product: {
    unitWeightKg: Prisma.Decimal;
    defaultPurchasePriceCny: Prisma.Decimal | null;
    category: { id: string; name: string };
    [key: string]: unknown;
  }) {
    return {
      ...product,
      unitWeightKg: publicDecimal(product.unitWeightKg),
      defaultPurchasePriceCny: product.defaultPurchasePriceCny
        ? publicDecimal(product.defaultPurchasePriceCny)
        : null,
    };
  }

  async nextCode(): Promise<string> {
    const last = await this.prisma.product.findFirst({
      where: { code: { startsWith: 'T-' } },
      orderBy: { code: 'desc' },
    });
    const match = last?.code.match(/^T-(\d+)$/);
    const current = match ? Number(match[1]) : 0;
    return `T-${String(current + 1).padStart(4, '0')}`;
  }

  async list(search?: string, active?: string) {
    const where: Prisma.ProductWhereInput = {};
    if (active === 'true') where.isActive = true;
    if (active === 'false') where.isActive = false;
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { category: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }
    const products = await this.prisma.product.findMany({
      where,
      include: { category: true },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return products.map((p) => this.serialize(p));
  }

  async get(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { category: true },
    });
    if (!product) throw new NotFoundException('Товар не найден');
    return this.serialize(product);
  }

  private parseWeight(value: string) {
    const n = new Prisma.Decimal(value);
    if (n.lte(0)) {
      throw new BadRequestException('Вес единицы должен быть больше 0');
    }
    return n;
  }

  private parseOptionalPrice(value?: string | null) {
    if (value === undefined || value === null || value === '') return null;
    const n = new Prisma.Decimal(value);
    if (n.lt(0)) {
      throw new BadRequestException('Цена в CNY не может быть отрицательной');
    }
    return n;
  }

  async create(dto: CreateProductDto) {
    const category = await this.prisma.productCategory.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category) throw new BadRequestException('Категория не найдена');

    const product = await this.prisma.product.create({
      data: {
        code: await this.nextCode(),
        name: dto.name.trim(),
        categoryId: dto.categoryId,
        unit: dto.unit.trim(),
        unitWeightKg: this.parseWeight(dto.unitWeightKg),
        defaultPurchasePriceCny: this.parseOptionalPrice(dto.defaultPurchasePriceCny),
        isActive: dto.isActive ?? true,
      },
      include: { category: true },
    });
    return this.serialize(product);
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.get(id);
    if (dto.categoryId) {
      const category = await this.prisma.productCategory.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category) throw new BadRequestException('Категория не найдена');
    }
    const product = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit.trim() } : {}),
        ...(dto.unitWeightKg !== undefined ? { unitWeightKg: this.parseWeight(dto.unitWeightKg) } : {}),
        ...(dto.defaultPurchasePriceCny !== undefined
          ? { defaultPurchasePriceCny: this.parseOptionalPrice(dto.defaultPurchasePriceCny) }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: { category: true },
    });
    return this.serialize(product);
  }

  async deactivate(id: string) {
    return this.update(id, { isActive: false });
  }

  async listCategories() {
    return this.prisma.productCategory.findMany({ orderBy: { name: 'asc' } });
  }

  async createCategory(dto: CreateCategoryDto) {
    const name = dto.name.trim();
    const existing = await this.prisma.productCategory.findUnique({ where: { name } });
    if (existing) return existing;
    return this.prisma.productCategory.create({ data: { name } });
  }

  async saveImage(id: string, file: Express.Multer.File) {
    if (!file?.buffer) {
      throw new BadRequestException('Файл изображения не загружен');
    }
    await this.get(id);
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = extname(file.originalname || '').toLowerCase() || '.jpg';
    if (!allowed.includes(ext)) {
      throw new BadRequestException('Допустимы изображения JPG, PNG или WEBP');
    }
    const dir = join(process.cwd(), process.env.UPLOAD_DIR || 'uploads', 'products');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const filename = `${id}${ext}`;
    const dest = join(dir, filename);
    await pipeline(
      (await import('stream')).Readable.from(file.buffer),
      createWriteStream(dest),
    );
    const imageUrl = `/uploads/products/${filename}`;
    const product = await this.prisma.product.update({
      where: { id },
      data: { imageUrl },
      include: { category: true },
    });
    return this.serialize(product);
  }

  async removeImage(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Товар не найден');
    if (product.imageUrl) {
      const filePath = join(process.cwd(), product.imageUrl.replace(/^\//, ''));
      if (existsSync(filePath)) {
        unlinkSync(filePath);
      }
    }
    const updated = await this.prisma.product.update({
      where: { id },
      data: { imageUrl: null },
      include: { category: true },
    });
    return this.serialize(updated);
  }
}
