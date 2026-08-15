import { Injectable } from '@nestjs/common';
import {
  ClientPricingCategory,
  ClientType,
  Prisma,
  SalePaymentStatus,
  SaleReturnStatus,
  SaleStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { publicDecimal } from '../common/decimal.util';
import { dec, roundMoney } from '../purchases/purchase-calc';
import {
  CategoryThresholdInput,
  getNextCategoryInfo,
  resolveCategoryFromAmount,
  rolling90DayWindowStart,
} from './pricing-calc';

export interface ClientPricingSnapshot {
  clientType: ClientType;
  clientCategory: ClientPricingCategory;
  paidPurchaseAmount90DaysKgs: string;
  additionalMarkupPercent: string;
  nextCategory: ClientPricingCategory | null;
  amountRemainingToNextCategoryKgs: string | null;
}

@Injectable()
export class ClientCategoryService {
  constructor(private readonly prisma: PrismaService) {}

  windowStart(referenceDate = new Date()): Date {
    return rolling90DayWindowStart(referenceDate);
  }

  async loadThresholds(): Promise<CategoryThresholdInput[]> {
    const rows = await this.prisma.clientCategoryThreshold.findMany({
      orderBy: [{ priority: 'asc' }, { minPaidAmountKgs: 'asc' }],
    });
    return rows.map((row) => ({
      category: row.category,
      minPaidAmountKgs: row.minPaidAmountKgs,
      maxPaidAmountKgs: row.maxPaidAmountKgs,
      priority: row.priority,
      isActive: row.isActive,
    }));
  }

  async calculatePaidPurchaseAmount90Days(
    clientId: string,
    referenceDate = new Date(),
  ): Promise<Prisma.Decimal> {
    const windowStart = this.windowStart(referenceDate);

    const paidSales = await this.prisma.sale.aggregate({
      where: {
        clientId,
        status: SaleStatus.COMPLETED,
        paymentStatus: SalePaymentStatus.PAID,
        fullyPaidAt: { gte: windowStart },
      },
      _sum: { totalAmountKgs: true },
    });

    const returns = await this.prisma.saleReturn.aggregate({
      where: {
        clientId,
        status: SaleReturnStatus.COMPLETED,
        sale: {
          status: SaleStatus.COMPLETED,
          paymentStatus: SalePaymentStatus.PAID,
          fullyPaidAt: { gte: windowStart },
        },
      },
      _sum: { totalRefundKgs: true },
    });

    const salesTotal = dec(paidSales._sum.totalAmountKgs ?? 0);
    const returnsTotal = dec(returns._sum.totalRefundKgs ?? 0);
    const net = roundMoney(salesTotal.minus(returnsTotal));
    return net.lt(0) ? roundMoney(0) : net;
  }

  resolveCategory(
    paidAmountKgs: Prisma.Decimal | string | number,
    thresholds: CategoryThresholdInput[],
    referenceDate = new Date(),
  ): ClientPricingCategory {
    return resolveCategoryFromAmount(paidAmountKgs, thresholds, referenceDate);
  }

  async getClientPricingSnapshot(
    clientId: string,
    clientType: ClientType,
    referenceDate = new Date(),
  ): Promise<ClientPricingSnapshot> {
    const thresholds = await this.loadThresholds();
    const paidAmount = await this.calculatePaidPurchaseAmount90Days(
      clientId,
      referenceDate,
    );
    const clientCategory = this.resolveCategory(
      paidAmount,
      thresholds,
      referenceDate,
    );

    const markupRow = await this.prisma.clientTypeCategoryMarkup.findUnique({
      where: {
        clientType_category: { clientType, category: clientCategory },
      },
    });

    const nextInfo = getNextCategoryInfo(
      paidAmount,
      clientCategory,
      thresholds,
    );

    return {
      clientType,
      clientCategory,
      paidPurchaseAmount90DaysKgs: publicDecimal(paidAmount),
      additionalMarkupPercent: publicDecimal(markupRow?.markupPercent ?? 0),
      nextCategory: nextInfo.nextCategory,
      amountRemainingToNextCategoryKgs:
        nextInfo.amountRemainingKgs === null
          ? null
          : publicDecimal(nextInfo.amountRemainingKgs),
    };
  }
}
