import { Injectable } from '@nestjs/common';
import { Prisma, SalePaymentStatus, SaleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { publicDecimal } from '../common/decimal.util';
import { dec, roundMoney } from '../purchases/purchase-calc';

@Injectable()
export class ClientDebtService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentDebtKgs(clientId: string): Promise<Prisma.Decimal> {
    const aggregate = await this.prisma.sale.aggregate({
      where: {
        clientId,
        status: { in: [SaleStatus.COMPLETED, SaleStatus.CONFIRMED] },
        paymentStatus: { in: [SalePaymentStatus.PARTIAL, SalePaymentStatus.UNPAID] },
      },
      _sum: { debtAmountKgs: true },
    });
    return roundMoney(aggregate._sum.debtAmountKgs ?? 0);
  }

  async getDebtSummary(clientId: string) {
    const currentDebtKgs = await this.getCurrentDebtKgs(clientId);
    const openSales = await this.prisma.sale.findMany({
      where: {
        clientId,
        debtAmountKgs: { gt: 0 },
        status: { in: [SaleStatus.COMPLETED, SaleStatus.CONFIRMED] },
      },
      orderBy: [{ confirmedAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        number: true,
        totalAmountKgs: true,
        paidAmountKgs: true,
        debtAmountKgs: true,
        confirmedAt: true,
        saleDate: true,
      },
    });

    const transactions = await this.prisma.clientDebtTransaction.findMany({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        sale: { select: { number: true } },
        recordedBy: { select: { id: true, name: true } },
      },
    });

    return {
      currentDebtKgs: publicDecimal(currentDebtKgs),
      openSales: openSales.map((sale) => ({
        ...sale,
        totalAmountKgs: publicDecimal(sale.totalAmountKgs),
        paidAmountKgs: publicDecimal(sale.paidAmountKgs),
        debtAmountKgs: publicDecimal(sale.debtAmountKgs),
      })),
      transactions: transactions.map((row) => ({
        id: row.id,
        type: row.type,
        amountKgs: publicDecimal(row.amountKgs),
        balanceAfterKgs: publicDecimal(row.balanceAfterKgs),
        saleNumber: row.sale?.number ?? null,
        note: row.note,
        createdAt: row.createdAt.toISOString(),
        recordedBy: row.recordedBy,
      })),
    };
  }

  async recordDebtChange(
    tx: Prisma.TransactionClient,
    input: {
      clientId: string;
      saleId?: string;
      type: 'SALE_DEBT' | 'DEBT_PAYMENT';
      amountKgs: Prisma.Decimal;
      recordedByUserId: string;
      paymentId?: string;
      note?: string;
    },
  ) {
    const current = await tx.sale.aggregate({
      where: {
        clientId: input.clientId,
        status: { in: [SaleStatus.COMPLETED, SaleStatus.CONFIRMED] },
        debtAmountKgs: { gt: 0 },
      },
      _sum: { debtAmountKgs: true },
    });
    let balance = roundMoney(current._sum.debtAmountKgs ?? 0);
    if (input.type === 'SALE_DEBT') {
      balance = roundMoney(balance.plus(input.amountKgs));
    } else {
      balance = roundMoney(balance.minus(input.amountKgs));
    }
    if (balance.lt(0)) balance = roundMoney(0);

    return tx.clientDebtTransaction.create({
      data: {
        clientId: input.clientId,
        saleId: input.saleId,
        type: input.type,
        amountKgs: input.amountKgs,
        balanceAfterKgs: balance,
        recordedByUserId: input.recordedByUserId,
        paymentId: input.paymentId,
        note: input.note,
      },
    });
  }
}
