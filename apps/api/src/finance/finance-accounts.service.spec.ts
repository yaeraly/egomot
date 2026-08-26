import { Test, TestingModule } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FinanceSettingsService } from './finance-balance.service';
import { FinanceAccountsService } from './finance-accounts.service';

describe('FinanceAccountsService', () => {
  let service: FinanceAccountsService;
  const prisma = {
    paymentMethod: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
    },
    paymentAccount: {
      upsert: jest.fn(),
      updateMany: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    user: { findMany: jest.fn() },
  };
  const financeSettings = { ensureUserAccounts: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceAccountsService,
        { provide: PrismaService, useValue: prisma },
        { provide: FinanceSettingsService, useValue: financeSettings },
      ],
    }).compile();
    service = module.get(FinanceAccountsService);
  });

  it('lists payment methods with counts', async () => {
    prisma.paymentMethod.findMany.mockResolvedValue([
      {
        id: 'pm-1',
        code: 'CASH',
        name: 'Наличные',
        isActive: true,
        sortOrder: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        _count: { accounts: 2, payments: 10 },
      },
    ]);

    const rows = await service.list();
    expect(rows[0].accountCount).toBe(2);
    expect(rows[0].name).toBe('Наличные');
  });

  it('provisions operator accounts when creating active method', async () => {
    prisma.paymentMethod.findUnique.mockResolvedValue(null);
    prisma.paymentMethod.aggregate.mockResolvedValue({ _max: { sortOrder: 5 } });
    prisma.paymentMethod.create.mockResolvedValue({
      id: 'pm-new',
      code: 'PAYBOX',
      name: 'Paybox',
      isActive: true,
      sortOrder: 6,
      createdAt: new Date(),
      updatedAt: new Date(),
      _count: { accounts: 0, payments: 0 },
    });
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', name: 'Owner', role: UserRole.OWNER },
    ]);

    await service.create({ code: 'PAYBOX', name: 'Paybox' });

    expect(prisma.paymentAccount.upsert).toHaveBeenCalled();
  });
});
