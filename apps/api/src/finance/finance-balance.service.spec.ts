import { Test, TestingModule } from '@nestjs/testing';
import { FinanceBalanceService } from './finance-balance.service';
import { PrismaService } from '../prisma/prisma.service';

describe('FinanceBalanceService', () => {
  let service: FinanceBalanceService;
  const prisma = {
    paymentAccount: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    financialTransaction: {
      aggregate: jest.fn(),
    },
    paymentMethod: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceBalanceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(FinanceBalanceService);
  });

  it('aggregates employee balance from ledger per account', async () => {
    prisma.paymentAccount.findMany.mockResolvedValue([
      {
        id: 'acc-cash',
        name: 'Бакыт — Наличные',
        paymentMethod: { code: 'CASH', name: 'Наличные', sortOrder: 1 },
      },
      {
        id: 'acc-mbank',
        name: 'Бакыт — MBank',
        paymentMethod: { code: 'MBANK', name: 'MBank', sortOrder: 2 },
      },
    ]);
    prisma.financialTransaction.aggregate
      .mockResolvedValueOnce({ _sum: { amountKgs: '35000' } })
      .mockResolvedValueOnce({ _sum: { amountKgs: '82500' } });

    const balance = await service.getEmployeeBalance('user-1');
    expect(balance.accounts).toHaveLength(2);
    expect(balance.accounts[0].balanceKgs).toBe('35000');
    expect(balance.accounts[1].balanceKgs).toBe('82500');
    expect(balance.totalBalanceKgs).toBe('117500');
  });

  it('resolves payment account for user', async () => {
    prisma.paymentAccount.findFirst.mockResolvedValue({
      id: 'acc-1',
      paymentMethodId: 'pm-1',
      paymentMethod: { code: 'CASH', name: 'Наличные' },
    });
    const account = await service.resolvePaymentAccount('user-1', 'acc-1');
    expect(account.id).toBe('acc-1');
  });
});
