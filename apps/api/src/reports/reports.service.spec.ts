import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsService } from './reports.service';

describe('ReportsService business dates', () => {
  let service: ReportsService;
  let prisma: {
    purchase: { findMany: jest.Mock };
    purchaseReceipt: { findMany: jest.Mock };
    inventoryMovement: { findMany: jest.Mock };
    sale: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      purchase: { findMany: jest.fn().mockResolvedValue([]) },
      purchaseReceipt: { findMany: jest.fn().mockResolvedValue([]) },
      inventoryMovement: { findMany: jest.fn().mockResolvedValue([]) },
      sale: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ReportsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get(ReportsService);
  });

  it('purchase report filters by purchaseDate range and excludes drafts', async () => {
    await service.purchaseReport({ from: '2026-03-01', to: '2026-03-31' });
    expect(prisma.purchase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          purchaseDate: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
          status: { not: 'DRAFT' },
        }),
      }),
    );
  });

  it('receipt report filters by warehouseReceiptDate range', async () => {
    await service.receiptReport({ from: '2026-03-01', to: '2026-03-31' });
    expect(prisma.purchaseReceipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          warehouseReceiptDate: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
          status: 'COMPLETED',
        }),
      }),
    );
  });

  it('inventory movement report filters by transactionDate range', async () => {
    await service.inventoryMovementReport({
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(prisma.inventoryMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          transactionDate: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
        }),
        orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
      }),
    );
  });

  it('sale report filters by saleDate range and confirmed statuses', async () => {
    await service.saleReport({ from: '2026-03-01', to: '2026-03-31' });
    expect(prisma.sale.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          saleDate: expect.objectContaining({
            gte: expect.any(Date),
            lte: expect.any(Date),
          }),
          status: { in: ['CONFIRMED', 'COMPLETED'] },
        }),
      }),
    );
  });
});
