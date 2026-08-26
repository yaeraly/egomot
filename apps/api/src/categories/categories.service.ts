import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { slugifyCategoryName, uniqueCategorySlug } from '../common/slug.util';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  private serialize(category: {
    _count?: { products: number };
    [key: string]: unknown;
  }) {
    const { _count, ...rest } = category;
    return {
      ...rest,
      productCount: _count?.products ?? 0,
    };
  }

  async list(search?: string, active?: string) {
    const where: Prisma.CategoryWhereInput = {};
    if (active === 'true') where.isActive = true;
    if (active === 'false') where.isActive = false;
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q, mode: 'insensitive' } },
      ];
    }
    const rows = await this.prisma.category.findMany({
      where,
      include: { _count: { select: { products: true } } },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return rows.map((row) => this.serialize(row));
  }

  async get(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        _count: { select: { products: true } },
        products: {
          include: { category: true },
          orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        },
      },
    });
    if (!category) throw new NotFoundException('Категория не найдена');
    return {
      ...this.serialize(category),
      products: category.products.map((product) => ({
        ...product,
        unitWeightKg: product.unitWeightKg.toFixed(3),
        defaultPurchasePriceCny: product.defaultPurchasePriceCny?.toFixed(2) ?? null,
      })),
    };
  }

  async create(dto: CreateCategoryDto) {
    const name = dto.name.trim();
    const existing = await this.prisma.category.findUnique({ where: { name } });
    if (existing) {
      throw new ConflictException('Категория с таким названием уже существует');
    }
    const slug = await uniqueCategorySlug(name, async (candidate) => {
      const row = await this.prisma.category.findUnique({ where: { slug: candidate } });
      return Boolean(row);
    });
    const category = await this.prisma.category.create({
      data: {
        name,
        slug,
        isActive: dto.isActive ?? true,
      },
      include: { _count: { select: { products: true } } },
    });
    return this.serialize(category);
  }

  async update(id: string, dto: UpdateCategoryDto) {
    const current = await this.prisma.category.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Категория не найдена');

    let slug = current.slug;
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      const duplicate = await this.prisma.category.findFirst({
        where: { name, NOT: { id } },
      });
      if (duplicate) {
        throw new ConflictException('Категория с таким названием уже существует');
      }
      const baseSlug = slugifyCategoryName(name);
      if (baseSlug !== current.slug) {
        slug = await uniqueCategorySlug(name, async (candidate) => {
          const row = await this.prisma.category.findFirst({
            where: { slug: candidate, NOT: { id } },
          });
          return Boolean(row);
        });
      }
    }

    const category = await this.prisma.category.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim(), slug } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
      include: { _count: { select: { products: true } } },
    });
    return this.serialize(category);
  }

  async remove(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!category) throw new NotFoundException('Категория не найдена');
    if (category._count.products > 0) {
      throw new BadRequestException('Нельзя удалить категорию, пока в ней есть товары.');
    }
    await this.prisma.category.delete({ where: { id } });
    return { ok: true };
  }
}
