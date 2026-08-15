import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createWriteStream, mkdirSync, existsSync, unlinkSync } from 'fs';
import { extname, join } from 'path';
import { pipeline } from 'stream/promises';
import { PrismaService } from '../prisma/prisma.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { publicDecimal } from '../common/decimal.util';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(product: {
    unitWeightKg: Prisma.Decimal;
    defaultPurchasePriceCny: Prisma.Decimal | null;
    baseMarkupPercent: Prisma.Decimal | null;
    category: { id: string; name: string; slug: string; isActive: boolean };
    [key: string]: unknown;
  }) {
    return {
      ...product,
      unitWeightKg: publicDecimal(product.unitWeightKg),
      defaultPurchasePriceCny: product.defaultPurchasePriceCny
        ? publicDecimal(product.defaultPurchasePriceCny)
        : null,
      baseMarkupPercent:
        product.baseMarkupPercent != null
          ? publicDecimal(product.baseMarkupPercent)
          : null,
    };
  }

  async nextCode(): Promise<string> {
    const codes = await this.prisma.product.findMany({
      where: {
        OR: [{ code: { startsWith: 'PRD-' } }, { code: { startsWith: 'T-' } }],
      },
      select: { code: true },
    });
    let max = 0;
    for (const row of codes) {
      const match = row.code.match(/^(?:PRD|T)-(\d+)$/);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `PRD-${String(max + 1).padStart(4, '0')}`;
  }

  async list(search?: string, active?: string, categoryId?: string) {
    const where: Prisma.ProductWhereInput = {};
    if (active === 'true') where.isActive = true;
    if (active === 'false') where.isActive = false;
    if (categoryId) where.categoryId = categoryId;
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

  async listPurchasePriceHistory(id: string) {
    await this.get(id);
    const rows = await this.prisma.productPurchasePriceHistory.findMany({
      where: { productId: id },
      include: {
        purchase: { select: { id: true, number: true } },
        changedBy: { select: { id: true, name: true } },
      },
      orderBy: { changedAt: 'desc' },
    });
    return rows.map((row) => ({
      id: row.id,
      previousPriceCny: row.previousPriceCny
        ? publicDecimal(row.previousPriceCny)
        : null,
      newPriceCny: publicDecimal(row.newPriceCny),
      changedAt: row.changedAt.toISOString(),
      purchase: row.purchase
        ? { id: row.purchase.id, number: row.purchase.number }
        : null,
      changedBy: row.changedBy
        ? { id: row.changedBy.id, name: row.changedBy.name }
        : null,
    }));
  }

  private parseWeight(value: string) {
    const n = new Prisma.Decimal(value);
    if (n.lt(0)) {
      throw new BadRequestException('Вес не может быть отрицательным');
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

  private parseOptionalMarkup(value?: string | null) {
    if (value === undefined || value === null || value === '') return null;
    const n = new Prisma.Decimal(value);
    if (n.lt(0)) {
      throw new BadRequestException(
        'Базовая наценка не может быть отрицательной',
      );
    }
    return n;
  }

  async create(dto: CreateProductDto) {
    const category = await this.prisma.category.findUnique({
      where: { id: dto.categoryId },
    });
    if (!category) throw new BadRequestException('Категория не найдена');

    const name = dto.name.trim();
    const duplicate = await this.prisma.product.findUnique({ where: { name } });
    if (duplicate) {
      throw new ConflictException('Товар с таким названием уже существует');
    }

    const product = await this.prisma.product.create({
      data: {
        code: await this.nextCode(),
        name,
        categoryId: dto.categoryId,
        unit: dto.unit.trim(),
        unitWeightKg: this.parseWeight(dto.unitWeightKg),
        defaultPurchasePriceCny: this.parseOptionalPrice(
          dto.defaultPurchasePriceCny,
        ),
        baseMarkupPercent: this.parseOptionalMarkup(dto.baseMarkupPercent),
        isActive: dto.isActive ?? true,
      },
      include: { category: true },
    });
    return this.serialize(product);
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.get(id);
    if (dto.categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: dto.categoryId },
      });
      if (!category) throw new BadRequestException('Категория не найдена');
    }
    if (dto.name !== undefined) {
      const duplicate = await this.prisma.product.findFirst({
        where: { name: dto.name.trim(), NOT: { id } },
      });
      if (duplicate) {
        throw new ConflictException('Товар с таким названием уже существует');
      }
    }
    const product = await this.prisma.product.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit.trim() } : {}),
        ...(dto.unitWeightKg !== undefined
          ? { unitWeightKg: this.parseWeight(dto.unitWeightKg) }
          : {}),
        ...(dto.defaultPurchasePriceCny !== undefined
          ? {
              defaultPurchasePriceCny: this.parseOptionalPrice(
                dto.defaultPurchasePriceCny,
              ),
            }
          : {}),
        ...(dto.baseMarkupPercent !== undefined
          ? {
              baseMarkupPercent: this.parseOptionalMarkup(
                dto.baseMarkupPercent,
              ),
            }
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

  async remove(id: string) {
    await this.get(id);
    return this.deactivate(id);
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
    const dir = join(
      process.cwd(),
      process.env.UPLOAD_DIR || 'uploads',
      'products',
    );
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
