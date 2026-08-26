import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { publicDecimal } from '../common/decimal.util';
import { dec, roundMoney } from '../purchases/purchase-calc';
import { COMPANY_PAYMENT_METHOD_CODES } from '../accounting/accounting-codes';

@Injectable()
export class FinanceBalanceService {
  constructor(private readonly prisma: PrismaService) {}

  async listPaymentMethods(activeOnly = true) {
    return this.prisma.paymentMethod.findMany({
      where: {
        ...(activeOnly ? { isActive: true } : {}),
        NOT: { code: { in: [...COMPANY_PAYMENT_METHOD_CODES] } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async listUserPaymentAccounts(userId: string) {
    return this.prisma.paymentAccount.findMany({
      where: { userId, isActive: true, paymentMethod: { isActive: true } },
      include: { paymentMethod: true },
      orderBy: [{ paymentMethod: { sortOrder: 'asc' } }],
    });
  }

  async getEmployeeBalance(userId: string) {
    const accounts = await this.listUserPaymentAccounts(userId);
    const balances = await Promise.all(
      accounts.map(async (account) => {
        const aggregate = await this.prisma.financialTransaction.aggregate({
          where: { paymentAccountId: account.id },
          _sum: { amountKgs: true },
        });
        const balance = roundMoney(aggregate._sum.amountKgs ?? 0);
        return {
          accountId: account.id,
          accountName: account.name,
          paymentMethodCode: account.paymentMethod.code,
          paymentMethodName: account.paymentMethod.name,
          balanceKgs: publicDecimal(balance),
        };
      }),
    );

    const total = roundMoney(
      balances.reduce((sum, row) => sum.plus(dec(row.balanceKgs)), dec(0)),
    );

    return {
      accounts: balances,
      totalBalanceKgs: publicDecimal(total),
    };
  }

  async resolvePaymentAccount(userId: string, paymentAccountId: string) {
    const account = await this.prisma.paymentAccount.findFirst({
      where: {
        id: paymentAccountId,
        userId,
        isActive: true,
        paymentMethod: { isActive: true },
      },
      include: { paymentMethod: true },
    });
    if (!account) {
      throw new NotFoundException('Платёжный счёт не найден');
    }
    return account;
  }
}

@Injectable()
export class FinanceSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureUserAccounts(userId: string, userName: string) {
    const methods = await this.prisma.paymentMethod.findMany({
      where: {
        isActive: true,
        NOT: { code: { in: [...COMPANY_PAYMENT_METHOD_CODES] } },
      },
    });
    for (const method of methods) {
      await this.prisma.paymentAccount.upsert({
        where: {
          userId_paymentMethodId: { userId, paymentMethodId: method.id },
        },
        update: {},
        create: {
          userId,
          paymentMethodId: method.id,
          name: `${userName} — ${method.name}`,
          isActive: true,
        },
      });
    }
  }
}
