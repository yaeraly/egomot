import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service';
import { PrismaService } from '../prisma/prisma.service';
import { CATALOG_CATEGORY_NAMES, CATALOG_PRODUCTS } from '../../prisma/catalog-data';

describe('ProductsService', () => {
  let service: ProductsService;
  const prisma = {
    product: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    category: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(ProductsService);
  });

  it('3. creates product with category', async () => {
    prisma.category.findUnique.mockResolvedValue({ id: 'cat-1', name: 'Моторы' });
    prisma.product.findUnique.mockResolvedValue(null);
    prisma.product.findMany.mockResolvedValue([{ code: 'PRD-0001' }]);
    prisma.product.create.mockResolvedValue({
      id: 'p1',
      code: 'PRD-0001',
      name: 'Test',
      categoryId: 'cat-1',
      category: { id: 'cat-1', name: 'Моторы', slug: 'motory', isActive: true },
      unit: 'шт',
      unitWeightKg: { toFixed: () => '1.000' },
      defaultPurchasePriceCny: { toFixed: () => '10.00' },
      baseMarkupPercent: { toFixed: () => '30.0000' },
      isActive: true,
    });
    const result = await service.create({
      name: 'Test',
      categoryId: 'cat-1',
      unit: 'шт',
      unitWeightKg: '1',
      defaultPurchasePriceCny: '10',
      baseMarkupPercent: '30',
    });
    expect(result.category.id).toBe('cat-1');
    expect(result.baseMarkupPercent).toBe('30.0000');
    expect(prisma.product.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ categoryId: 'cat-1', baseMarkupPercent: expect.anything() }),
      }),
    );
  });

  it('persists and returns baseMarkupPercent on update', async () => {
    prisma.product.findUnique.mockResolvedValue({
      id: 'p1',
      code: 'PRD-0001',
      name: 'Test',
      categoryId: 'cat-1',
      category: { id: 'cat-1', name: 'Моторы', slug: 'motory', isActive: true },
      unit: 'шт',
      unitWeightKg: { toFixed: () => '1.000' },
      defaultPurchasePriceCny: null,
      baseMarkupPercent: { toFixed: () => '30.0000' },
      isActive: true,
    });
    prisma.product.update.mockResolvedValue({
      id: 'p1',
      code: 'PRD-0001',
      name: 'Test',
      categoryId: 'cat-1',
      category: { id: 'cat-1', name: 'Моторы', slug: 'motory', isActive: true },
      unit: 'шт',
      unitWeightKg: { toFixed: () => '1.000' },
      defaultPurchasePriceCny: null,
      baseMarkupPercent: { toFixed: () => '35.0000' },
      isActive: true,
    });
    const result = await service.update('p1', { baseMarkupPercent: '35' });
    expect(result.baseMarkupPercent).toBe('35.0000');
    expect(prisma.product.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ baseMarkupPercent: expect.anything() }),
      }),
    );
  });

  it('6. filters products by category', async () => {
    prisma.product.findMany.mockResolvedValue([]);
    await service.list(undefined, undefined, 'cat-1');
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ categoryId: 'cat-1' }),
      }),
    );
  });

  it('7. searches products', async () => {
    prisma.product.findMany.mockResolvedValue([]);
    await service.list('мотор');
    expect(prisma.product.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ name: expect.objectContaining({ contains: 'мотор' }) }),
          ]),
        }),
      }),
    );
  });
});

describe('catalog seed data', () => {
  it('10. has expected catalog categories', () => {
    expect(CATALOG_CATEGORY_NAMES).toHaveLength(21);
    expect(new Set(CATALOG_CATEGORY_NAMES).size).toBe(21);
  });

  it('11. has expected catalog products', () => {
    expect(CATALOG_PRODUCTS).toHaveLength(87);
    const names = new Set(CATALOG_PRODUCTS.map((row) => row.name));
    expect(names.size).toBe(CATALOG_PRODUCTS.length);
    const codes = new Set(CATALOG_PRODUCTS.map((row) => row.code));
    expect(codes.size).toBe(CATALOG_PRODUCTS.length);
  });

  it('12. every catalog product references a known category', () => {
    const categorySet = new Set(CATALOG_CATEGORY_NAMES);
    for (const row of CATALOG_PRODUCTS) {
      expect(categorySet.has(row.category as (typeof CATALOG_CATEGORY_NAMES)[number])).toBe(true);
      expect(row.weightKg).toMatch(/^\d+\.\d{3}$/);
      expect(row.purchasePriceCny).toMatch(/^\d+\.\d{2}$/);
    }
  });
});
