import { Test, TestingModule } from '@nestjs/testing';
import { ClientPricingCategory, ClientType, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PricingSettingsService } from './pricing-settings.service';

describe('PricingSettingsService', () => {
  let service: PricingSettingsService;

  const user = {
    id: 'user-1',
    email: 'owner@test.local',
    name: 'Owner',
    role: UserRole.OWNER,
    passwordHash: 'hash',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const thresholds = [
    {
      id: 't1',
      category: ClientPricingCategory.STANDARD,
      minPaidAmountKgs: '0',
      maxPaidAmountKgs: '49999.99',
      priority: 1,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 't2',
      category: ClientPricingCategory.SILVER,
      minPaidAmountKgs: '50000',
      maxPaidAmountKgs: '149999.99',
      priority: 2,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 't3',
      category: ClientPricingCategory.GOLD,
      minPaidAmountKgs: '150000',
      maxPaidAmountKgs: '299999.99',
      priority: 3,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 't4',
      category: ClientPricingCategory.VIP,
      minPaidAmountKgs: '300000',
      maxPaidAmountKgs: null,
      priority: 4,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  const markup = {
    id: 'm1',
    clientType: ClientType.WHOLESALE,
    category: ClientPricingCategory.VIP,
    markupPercent: '0',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const prisma = {
    clientCategoryThreshold: { findMany: jest.fn() },
    clientTypeCategoryMarkup: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.clientCategoryThreshold.findMany.mockResolvedValue(thresholds);
    prisma.clientTypeCategoryMarkup.findMany.mockResolvedValue([markup]);
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PricingSettingsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(PricingSettingsService);
  });

  it('rejects overlapping threshold updates', async () => {
    await expect(
      service.updateThresholds(user, [
        {
          category: ClientPricingCategory.STANDARD,
          minPaidAmountKgs: '0',
          maxPaidAmountKgs: '100000',
          isActive: true,
        },
      ]),
    ).rejects.toThrow('пересекаются');
  });

  it('audits markup matrix updates', async () => {
    prisma.clientTypeCategoryMarkup.findUnique.mockResolvedValue(markup);
    prisma.clientTypeCategoryMarkup.update.mockResolvedValue({
      ...markup,
      markupPercent: '1',
    });

    await service.updateMarkupMatrix(user, [
      {
        clientType: ClientType.WHOLESALE,
        category: ClientPricingCategory.VIP,
        markupPercent: '1',
      },
    ]);

    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'PRICING_MARKUP_UPDATED',
          entityType: 'ClientTypeCategoryMarkup',
        }),
      }),
    );
  });
});
