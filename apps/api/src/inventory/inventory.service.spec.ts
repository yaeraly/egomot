import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { InventoryService } from './inventory.service';
import { PrismaService } from '../prisma/prisma.service';

describe('InventoryService', () => {
  let service: InventoryService;
  const prisma = {
    inventory: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [InventoryService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(InventoryService);
  });

  it('returns stock summary for in-stock SKUs only', async () => {
    prisma.inventory.findMany.mockResolvedValue([
      { quantity: new Prisma.Decimal('100'), totalValueKgs: new Prisma.Decimal('5000') },
      { quantity: new Prisma.Decimal('50.5'), totalValueKgs: new Prisma.Decimal('2500.50') },
    ]);

    const summary = await service.getStockSummary();

    expect(prisma.inventory.findMany).toHaveBeenCalledWith({
      where: { quantity: { gt: 0 } },
      select: { quantity: true, totalValueKgs: true },
    });
    expect(summary).toEqual({
      totalQuantity: '150.5',
      totalValueKgs: '7500.5',
      skuInStockCount: 2,
    });
  });

  it('returns zero summary when nothing is in stock', async () => {
    prisma.inventory.findMany.mockResolvedValue([]);

    const summary = await service.getStockSummary();

    expect(summary).toEqual({
      totalQuantity: '0',
      totalValueKgs: '0',
      skuInStockCount: 0,
    });
  });
});
