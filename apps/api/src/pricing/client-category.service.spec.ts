import { Test, TestingModule } from '@nestjs/testing';
import {
  ClientPricingCategory,
  ClientType,
  SalePaymentStatus,
  SaleReturnStatus,
  SaleStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ClientCategoryService } from './client-category.service';

describe('ClientCategoryService', () => {
  let service: ClientCategoryService;

  const prisma = {
    clientCategoryThreshold: { findMany: jest.fn() },
    sale: { aggregate: jest.fn() },
    saleReturn: { aggregate: jest.fn() },
    clientTypeCategoryMarkup: { findUnique: jest.fn() },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientCategoryService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(ClientCategoryService);
  });

  const thresholds = [
    {
      category: ClientPricingCategory.STANDARD,
      minPaidAmountKgs: '0',
      maxPaidAmountKgs: '49999.99',
      priority: 1,
      isActive: true,
    },
    {
      category: ClientPricingCategory.SILVER,
      minPaidAmountKgs: '50000',
      maxPaidAmountKgs: '149999.99',
      priority: 2,
      isActive: true,
    },
    {
      category: ClientPricingCategory.GOLD,
      minPaidAmountKgs: '150000',
      maxPaidAmountKgs: '299999.99',
      priority: 3,
      isActive: true,
    },
    {
      category: ClientPricingCategory.VIP,
      minPaidAmountKgs: '300000',
      maxPaidAmountKgs: null,
      priority: 4,
      isActive: true,
    },
  ];

  it('calculates net paid amount minus returns for fully paid sales in window', async () => {
    prisma.clientCategoryThreshold.findMany.mockResolvedValue(thresholds);
    prisma.sale.aggregate.mockResolvedValue({
      _sum: { totalAmountKgs: '100000' },
    });
    prisma.saleReturn.aggregate.mockResolvedValue({
      _sum: { totalRefundKgs: '20000' },
    });

    const amount = await service.calculatePaidPurchaseAmount90Days('client-1');
    expect(amount.toFixed(2)).toBe('80000.00');

    expect(prisma.sale.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clientId: 'client-1',
          status: SaleStatus.COMPLETED,
          paymentStatus: SalePaymentStatus.PAID,
        }),
      }),
    );
  });

  it('returns zero when no eligible sales', async () => {
    prisma.sale.aggregate.mockResolvedValue({ _sum: { totalAmountKgs: null } });
    prisma.saleReturn.aggregate.mockResolvedValue({
      _sum: { totalRefundKgs: null },
    });

    const amount = await service.calculatePaidPurchaseAmount90Days('client-1');
    expect(amount.toFixed(2)).toBe('0.00');
  });

  it('builds client pricing snapshot', async () => {
    prisma.clientCategoryThreshold.findMany.mockResolvedValue(thresholds);
    prisma.sale.aggregate.mockResolvedValue({
      _sum: { totalAmountKgs: '210000' },
    });
    prisma.saleReturn.aggregate.mockResolvedValue({
      _sum: { totalRefundKgs: null },
    });
    prisma.clientTypeCategoryMarkup.findUnique.mockResolvedValue({
      markupPercent: '3',
    });

    const snapshot = await service.getClientPricingSnapshot(
      'client-1',
      ClientType.MASTER,
    );

    expect(snapshot.clientCategory).toBe(ClientPricingCategory.GOLD);
    expect(snapshot.paidPurchaseAmount90DaysKgs).toBe('210000');
    expect(snapshot.additionalMarkupPercent).toBe('3');
    expect(snapshot.nextCategory).toBe(ClientPricingCategory.VIP);
    expect(snapshot.amountRemainingToNextCategoryKgs).toBe('90000');
  });

  it('excludes partial/unpaid sales via query filters', async () => {
    prisma.sale.aggregate.mockResolvedValue({
      _sum: { totalAmountKgs: '60000' },
    });
    prisma.saleReturn.aggregate.mockResolvedValue({
      _sum: { totalRefundKgs: null },
    });
    await service.calculatePaidPurchaseAmount90Days('client-1');

    const where = prisma.sale.aggregate.mock.calls[0][0].where;
    expect(where.paymentStatus).toBe(SalePaymentStatus.PAID);
    expect(where.status).toBe(SaleStatus.COMPLETED);
    expect(where.fullyPaidAt).toBeDefined();
  });

  it('subtracts completed returns linked to eligible sales', async () => {
    prisma.sale.aggregate.mockResolvedValue({
      _sum: { totalAmountKgs: '100000' },
    });
    prisma.saleReturn.aggregate.mockResolvedValue({
      _sum: { totalRefundKgs: '100000' },
    });

    const amount = await service.calculatePaidPurchaseAmount90Days('client-1');
    expect(amount.toFixed(2)).toBe('0.00');

    const returnWhere = prisma.saleReturn.aggregate.mock.calls[0][0].where;
    expect(returnWhere.status).toBe(SaleReturnStatus.COMPLETED);
  });
});
