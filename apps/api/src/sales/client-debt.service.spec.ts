import { Test, TestingModule } from '@nestjs/testing';
import { ClientDebtService } from './client-debt.service';
import { PrismaService } from '../prisma/prisma.service';

describe('ClientDebtService', () => {
  let service: ClientDebtService;
  const prisma = {
    sale: {
      aggregate: jest.fn(),
      findMany: jest.fn(),
    },
    clientDebtTransaction: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientDebtService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(ClientDebtService);
  });

  it('returns current debt from open sales', async () => {
    prisma.sale.aggregate.mockResolvedValue({
      _sum: { debtAmountKgs: '75000' },
    });
    prisma.sale.findMany.mockResolvedValue([
      {
        id: 's1',
        number: 'S-01024',
        totalAmountKgs: '100000',
        paidAmountKgs: '70000',
        debtAmountKgs: '30000',
        confirmedAt: new Date(),
        saleDate: new Date(),
      },
      {
        id: 's2',
        number: 'S-01088',
        totalAmountKgs: '90000',
        paidAmountKgs: '45000',
        debtAmountKgs: '45000',
        confirmedAt: new Date(),
        saleDate: new Date(),
      },
    ]);
    prisma.clientDebtTransaction.findMany.mockResolvedValue([]);

    const summary = await service.getDebtSummary('client-1');
    expect(summary.currentDebtKgs).toBe('75000');
    expect(summary.openSales).toHaveLength(2);
    expect(summary.openSales[0].number).toBe('S-01024');
    expect(summary.openSales[0].debtAmountKgs).toBe('30000');
  });
});
