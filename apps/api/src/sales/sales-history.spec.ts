import { Test, TestingModule } from '@nestjs/testing';
import { SalePaymentStatus, SaleStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingService } from '../pricing/pricing.service';
import { ClientCategoryService } from '../pricing/client-category.service';
import { FinanceBalanceService } from '../finance/finance-balance.service';
import { ClientDebtService } from './client-debt.service';
import { SaleReceiptService, WhatsAppService } from './sale-receipt.service';
import { SalesService } from './sales.service';

describe('SalesService historical edits', () => {
  let service: SalesService;
  const owner = {
    id: 'owner-1',
    email: 'owner@test.local',
    name: 'Owner',
    role: UserRole.OWNER,
    passwordHash: 'hash',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const saleRow = {
    id: 'sale-1',
    number: 'S-00001',
    clientId: 'client-1',
    status: SaleStatus.CONFIRMED,
    paymentStatus: SalePaymentStatus.PARTIAL,
    saleDate: new Date('2026-03-15T10:30:00Z'),
    confirmedAt: new Date('2026-03-15T10:30:00Z'),
    fullyPaidAt: null,
    totalAmountKgs: '10000',
    paidAmountKgs: '7000',
    debtAmountKgs: '3000',
    clientTypeAtSale: 'RETAIL',
    clientCategoryAtSale: 'STANDARD',
    client: { id: 'client-1', name: 'Асан', clientType: 'RETAIL', phone: '+996555' },
    receipt: { number: 'R-00001' },
    items: [
      {
        id: 'item-1',
        productId: 'p1',
        quantity: '2',
        unitCostKgs: '5000',
        unitPriceKgs: '5000',
        lineTotalKgs: '10000',
        baseMarkupPercent: '30',
        clientMarkupPercent: '15',
        finalMarkupPercent: '45',
      },
    ],
  };

  const prisma = {
    sale: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    saleItem: { update: jest.fn() },
    inventoryMovement: { updateMany: jest.fn() },
    saleReceipt: { update: jest.fn() },
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) =>
      fn(prisma),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SalesService,
        { provide: PrismaService, useValue: prisma },
        { provide: PricingService, useValue: {} },
        {
          provide: ClientCategoryService,
          useValue: {
            getClientPricingSnapshot: jest.fn().mockResolvedValue({
              clientCategory: 'STANDARD',
            }),
          },
        },
        { provide: FinanceBalanceService, useValue: {} },
        {
          provide: ClientDebtService,
          useValue: { getCurrentDebtKgs: jest.fn().mockResolvedValue('0') },
        },
        { provide: SaleReceiptService, useValue: { buildPayload: jest.fn().mockReturnValue({}) } },
        { provide: WhatsAppService, useValue: {} },
      ],
    }).compile();
    service = module.get(SalesService);
  });

  it('updates historical sale date and inventory movement date', async () => {
    prisma.sale.findUnique.mockResolvedValueOnce(saleRow);
    prisma.sale.update.mockResolvedValue({
      ...saleRow,
      saleDate: new Date('2026-01-10T14:00:00Z'),
    });
    prisma.sale.findUniqueOrThrow.mockResolvedValue({
      ...saleRow,
      soldBy: { id: 'u1', name: 'Owner', role: UserRole.OWNER },
      items: saleRow.items,
      payments: [],
      receipt: saleRow.receipt,
    });

    await service.updateSaleDate(owner, 'sale-1', {
      saleDate: '2026-01-10T14:00:00.000Z',
    });

    expect(prisma.inventoryMovement.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ referenceId: 'sale-1' }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalled();
  });

  it('updates sale item price and recalculates totals', async () => {
    prisma.sale.findUnique.mockResolvedValue(saleRow);
    prisma.saleItem.update.mockResolvedValue({});
    prisma.sale.update.mockResolvedValue({
      ...saleRow,
      totalAmountKgs: '12000',
      debtAmountKgs: '5000',
    });

    await service.updateSaleItemPrice(owner, 'sale-1', 'item-1', {
      unitPriceKgs: '6000',
    });

    expect(prisma.saleItem.update).toHaveBeenCalled();
    expect(prisma.sale.update).toHaveBeenCalled();
  });

  it('rejects price update below paid amount', async () => {
    prisma.sale.findUnique.mockResolvedValue({
      ...saleRow,
      paidAmountKgs: '9000',
    });

    await expect(
      service.updateSaleItemPrice(owner, 'sale-1', 'item-1', {
        unitPriceKgs: '1000',
      }),
    ).rejects.toThrow('не может быть меньше');
  });
});
