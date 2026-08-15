import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CategoriesService', () => {
  let service: CategoriesService;
  const prisma = {
    category: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [CategoriesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(CategoriesService);
  });

  it('1. creates category with slug', async () => {
    prisma.category.findUnique.mockResolvedValue(null);
    prisma.category.create.mockResolvedValue({
      id: 'c1',
      name: 'Моторы',
      slug: 'motory',
      isActive: true,
      _count: { products: 0 },
    });
    const result = await service.create({ name: 'Моторы' });
    expect(result.slug).toBe('motory');
    expect(prisma.category.create).toHaveBeenCalled();
  });

  it('2. prevents duplicate category', async () => {
    prisma.category.findUnique.mockResolvedValue({ id: 'c1', name: 'Моторы' });
    await expect(service.create({ name: 'Моторы' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('5. returns product count', async () => {
    prisma.category.findMany.mockResolvedValue([
      { id: 'c1', name: 'Моторы', slug: 'motory', isActive: true, _count: { products: 5 } },
    ]);
    const rows = await service.list();
    expect(rows[0].productCount).toBe(5);
  });

  it('8. cannot delete category containing products', async () => {
    prisma.category.findUnique.mockResolvedValue({
      id: 'c1',
      _count: { products: 2 },
    });
    await expect(service.remove('c1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
