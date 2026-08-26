import { BadRequestException, Injectable } from '@nestjs/common';
import { JournalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { publicDecimal } from '../common/decimal.util';
import { resolveDateRange } from '../common/date.util';
import { moneyStr, roundMoney } from '../purchases/purchase-calc';
import {
  buildBalanceSheet,
  buildCashFlowStatement,
  buildFinanceDashboard,
  buildProfitAndLoss,
  flattenJournalLines,
  linesInInclusiveRange,
  linesOnOrBefore,
  type CashFlowGroupBy,
  type PostedReportJournal,
} from './accounting-reports.logic';

@Injectable()
export class AccountingReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async loadJournals(): Promise<PostedReportJournal[]> {
    const rows = await this.prisma.journal.findMany({
      where: { status: JournalStatus.POSTED },
      include: {
        lines: { include: { account: true }, orderBy: { sortOrder: 'asc' } },
      },
      orderBy: [{ postedAt: 'asc' }, { number: 'asc' }],
    });
    return rows.map((row) => ({
      postedAt: row.postedAt,
      sourceType: row.sourceType,
      status: row.status,
      lines: row.lines.map((line) => ({
        accountCode: line.account.code,
        debitKgs: publicDecimal(line.debitKgs),
        creditKgs: publicDecimal(line.creditKgs),
      })),
    }));
  }

  resolveRange(query: { preset?: string; from?: string; to?: string }) {
    const range = resolveDateRange(query);
    if (!range) {
      throw new BadRequestException('Укажите период: preset или from/to');
    }
    return range;
  }

  async cashFlow(query: {
    preset?: string;
    from?: string;
    to?: string;
    groupBy?: string;
  }) {
    const range = this.resolveRange(query);
    const groupBy: CashFlowGroupBy =
      query.groupBy === 'day' || query.groupBy === 'month' || query.groupBy === 'range'
        ? query.groupBy
        : query.preset === 'today' || query.preset === 'yesterday'
          ? 'day'
          : query.preset === 'year'
            ? 'month'
            : 'range';
    const statement = buildCashFlowStatement({
      journals: await this.loadJournals(),
      from: range.from,
      to: range.to,
      groupBy,
    });
    return {
      range: {
        preset: range.preset,
        from: range.fromIso,
        to: range.toIso,
        groupBy,
      },
      ...statement,
    };
  }

  async profitAndLoss(query: { preset?: string; from?: string; to?: string }) {
    const range = this.resolveRange(query);
    const journals = await this.loadJournals();
    const lines = linesInInclusiveRange(flattenJournalLines(journals), range.from, range.to);
    return {
      range: { preset: range.preset, from: range.fromIso, to: range.toIso },
      ...buildProfitAndLoss(lines),
    };
  }

  async balanceSheet(query: { preset?: string; from?: string; to?: string }) {
    const range = this.resolveRange(query);
    const journals = await this.loadJournals();
    const lines = linesOnOrBefore(flattenJournalLines(journals), range.to);
    return {
      asOf: range.toIso,
      range: { preset: range.preset, from: range.fromIso, to: range.toIso },
      ...buildBalanceSheet(lines),
    };
  }

  async dashboard(query: { preset?: string; from?: string; to?: string }) {
    const range = this.resolveRange(query);
    const kpis = buildFinanceDashboard({
      journals: await this.loadJournals(),
      from: range.from,
      to: range.to,
    });
    return {
      range: { preset: range.preset, from: range.fromIso, to: range.toIso },
      ...kpis,
    };
  }

  async inventoryValuation() {
    const rows = await this.prisma.inventory.findMany({
      include: { product: { include: { category: true } } },
      orderBy: { product: { name: 'asc' } },
    });
    const totalValueKgs = moneyStr(
      rows.reduce((sum, row) => sum.plus(roundMoney(row.totalValueKgs)), roundMoney(0)),
    );
    return {
      totalValueKgs,
      skuCount: rows.length,
      rows: rows.map((row) => ({
        productId: row.productId,
        productCode: row.product.code,
        productName: row.product.name,
        categoryName: row.product.category.name,
        quantity: publicDecimal(row.quantity),
        averageUnitCostKgs: publicDecimal(row.averageUnitCostKgs),
        totalValueKgs: publicDecimal(row.totalValueKgs),
      })),
    };
  }
}
