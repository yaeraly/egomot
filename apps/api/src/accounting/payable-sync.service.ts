import { Injectable } from '@nestjs/common';
import { PayableStatus } from '@prisma/client';
import { publicDecimal } from '../common/decimal.util';
import { PrismaService } from '../prisma/prisma.service';
import { moneyStr, roundMoney } from '../purchases/purchase-calc';
import { ACCOUNT_CODE } from './accounting-codes';
import { payableStatusFromAmounts } from './accounting-journal.logic';
import {
  aggregateCargoApByPurchase,
  aggregateSupplierApByPurchase,
  aggregateTransportApByPurchaseAndType,
  sumRemaining,
  type JournalApInput,
  type PurchaseApAggregate,
  type PurchaseIdLookup,
} from './payable-sync.logic';

@Injectable()
export class PayableSyncService {
  constructor(private readonly prisma: PrismaService) {}

  async syncFromLedger() {
    const journals = await this.loadApJournals();
    const lookup = await this.buildLookup(journals);
    const supplier = aggregateSupplierApByPurchase(journals, lookup);
    const cargo = aggregateCargoApByPurchase(journals, lookup);
    const transport = aggregateTransportApByPurchaseAndType(journals, lookup);

    for (const row of supplier) {
      if (!row.recognizedKgs.gt(0) && !row.paidKgs.gt(0)) continue;
      await this.upsertSupplierPayable(row);
    }
    for (const row of cargo) {
      if (!row.recognizedKgs.gt(0) && !row.paidKgs.gt(0)) continue;
      await this.upsertLegacyCargoPayable(row);
    }
    for (const row of transport) {
      if (!row.recognizedKgs.gt(0) && !row.paidKgs.gt(0)) continue;
      await this.upsertLegacyTransportPayable(row);
    }

    return {
      supplierRemainingKgs: sumRemaining(supplier),
      cargoRemainingKgs: sumRemaining(cargo),
      transportRemainingKgs: sumRemaining(transport),
    };
  }

  async glBalances() {
    const journals = await this.loadApJournals();
    const lookup = await this.buildLookup(journals);
    return {
      supplierApKgs: sumRemaining(aggregateSupplierApByPurchase(journals, lookup)),
      cargoApKgs: sumRemaining(aggregateCargoApByPurchase(journals, lookup)),
      transportApKgs: sumRemaining(aggregateTransportApByPurchaseAndType(journals, lookup)),
    };
  }

  private async loadApJournals(): Promise<JournalApInput[]> {
    const rows = await this.prisma.journal.findMany({
      where: { status: 'POSTED' },
      include: {
        lines: { include: { account: true } },
        reversesJournal: { select: { sourceType: true, sourceId: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      reversesSourceType: row.reversesJournal?.sourceType ?? null,
      reversesSourceId: row.reversesJournal?.sourceId ?? null,
      postedAt: row.postedAt,
      lines: row.lines.map((line) => ({
        accountCode: line.account.code,
        debitKgs: publicDecimal(line.debitKgs),
        creditKgs: publicDecimal(line.creditKgs),
      })),
    }));
  }

  private async buildLookup(journals: JournalApInput[]): Promise<PurchaseIdLookup> {
    const receiptIds: string[] = [];
    const purchasePaymentIds: string[] = [];
    const cargoPaymentIds: string[] = [];
    const logisticsExpenseIds: string[] = [];
    const logisticsPaymentIds: string[] = [];
    const maybePurchaseIds: string[] = [];

    for (const journal of journals) {
      const type = journal.sourceType === 'REVERSAL' ? journal.reversesSourceType : journal.sourceType;
      const sourceId = journal.sourceType === 'REVERSAL' ? journal.reversesSourceId : journal.sourceId;
      if (!type || !sourceId) continue;
      if (type === 'PURCHASE_RECEIPT') receiptIds.push(sourceId);
      else if (type === 'PURCHASE_PAYMENT') purchasePaymentIds.push(sourceId);
      else if (type === 'CARGO_PAYMENT') {
        cargoPaymentIds.push(sourceId);
        logisticsPaymentIds.push(sourceId);
      } else if (type === 'CARGO' || type === 'PURCHASE') {
        maybePurchaseIds.push(sourceId);
        logisticsExpenseIds.push(sourceId);
      } else if (type === 'LOGISTICS_CHINA' || type === 'LOGISTICS_KYRGYZSTAN') {
        logisticsExpenseIds.push(sourceId);
      } else if (type === 'LOGISTICS_CHINA_PAYMENT' || type === 'LOGISTICS_KYRGYZSTAN_PAYMENT') {
        logisticsPaymentIds.push(sourceId);
      }
    }

    const [receipts, purchasePayments, cargoPayments, logisticsExpenses, logisticsPayments, purchases] =
      await Promise.all([
        receiptIds.length
          ? this.prisma.purchaseReceipt.findMany({
              where: { id: { in: [...new Set(receiptIds)] } },
              select: { id: true, purchaseId: true },
            })
          : Promise.resolve([]),
        purchasePaymentIds.length
          ? this.prisma.purchasePayment.findMany({
              where: { id: { in: [...new Set(purchasePaymentIds)] } },
              select: { id: true, purchaseId: true },
            })
          : Promise.resolve([]),
        cargoPaymentIds.length
          ? this.prisma.cargoPayment.findMany({
              where: { id: { in: [...new Set(cargoPaymentIds)] } },
              select: { id: true, cargoPayable: { select: { purchaseId: true } } },
            })
          : Promise.resolve([]),
        logisticsExpenseIds.length
          ? this.prisma.purchaseLogisticsExpense.findMany({
              where: { id: { in: [...new Set(logisticsExpenseIds)] } },
              select: { id: true, purchaseId: true },
            })
          : Promise.resolve([]),
        logisticsPaymentIds.length
          ? this.prisma.logisticsPayment.findMany({
              where: { id: { in: [...new Set(logisticsPaymentIds)] } },
              select: { id: true, logisticsExpense: { select: { purchaseId: true } } },
            })
          : Promise.resolve([]),
        maybePurchaseIds.length
          ? this.prisma.purchase.findMany({
              where: { id: { in: [...new Set(maybePurchaseIds)] } },
              select: { id: true },
            })
          : Promise.resolve([]),
      ]);

    return {
      receipts: new Map(receipts.map((row) => [row.id, row.purchaseId])),
      purchasePayments: new Map(purchasePayments.map((row) => [row.id, row.purchaseId])),
      cargoPayments: new Map(
        cargoPayments.map((row) => [row.id, row.cargoPayable.purchaseId]),
      ),
      logisticsExpenses: new Map(logisticsExpenses.map((row) => [row.id, row.purchaseId])),
      logisticsPayments: new Map(
        logisticsPayments.map((row) => [row.id, row.logisticsExpense.purchaseId]),
      ),
      purchaseIds: new Set(purchases.map((row) => row.id)),
    };
  }

  private async upsertSupplierPayable(row: PurchaseApAggregate) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: row.purchaseId },
      select: { supplierId: true },
    });
    if (!purchase) return;
    const amountKgs = moneyStr(row.recognizedKgs);
    const paidAmountKgs = moneyStr(row.paidKgs);
    const remainingAmountKgs = moneyStr(row.remainingKgs);
    const status = payableStatusFromAmounts(amountKgs, paidAmountKgs) as PayableStatus;
    const existing = await this.prisma.supplierPayable.findUnique({
      where: { purchaseId: row.purchaseId },
    });
    if (existing) {
      await this.prisma.supplierPayable.update({
        where: { id: existing.id },
        data: { amountKgs, paidAmountKgs, remainingAmountKgs, status },
      });
      return;
    }
    await this.prisma.supplierPayable.create({
      data: {
        supplierId: purchase.supplierId,
        purchaseId: row.purchaseId,
        amountKgs,
        paidAmountKgs,
        remainingAmountKgs,
        status,
      },
    });
  }

  private async upsertLegacyCargoPayable(row: PurchaseApAggregate) {
    const linked = await this.prisma.purchaseLogisticsExpense.findMany({
      where: { purchaseId: row.purchaseId, cargoPayableId: { not: null } },
      select: { cargoPayableId: true, remainingAmountKgs: true, amountKgs: true, paidAmountKgs: true },
    });
    const linkedRemaining = linked.reduce(
      (sum, item) => sum.plus(roundMoney(item.remainingAmountKgs)),
      roundMoney(0),
    );
    const residual = roundMoney(row.remainingKgs).minus(linkedRemaining);
    const residualRecognized = roundMoney(row.recognizedKgs).minus(
      linked.reduce((sum, item) => sum.plus(roundMoney(item.amountKgs)), roundMoney(0)),
    );
    const residualPaid = roundMoney(row.paidKgs).minus(
      linked.reduce((sum, item) => sum.plus(roundMoney(item.paidAmountKgs)), roundMoney(0)),
    );
    if (!residualRecognized.gt(0) && !residual.gt(0) && !residualPaid.gt(0)) {
      return;
    }
    if (residualRecognized.lte(0) && residual.lte(0)) return;

    const amountKgs = moneyStr(residualRecognized.gt(0) ? residualRecognized : residual.plus(residualPaid));
    const paidAmountKgs = moneyStr(residualPaid.gte(0) ? residualPaid : 0);
    const remainingAmountKgs = moneyStr(residual.gte(0) ? residual : 0);
    const status = payableStatusFromAmounts(amountKgs, paidAmountKgs) as PayableStatus;

    const existing = await this.prisma.cargoPayable.findFirst({
      where: { purchaseId: row.purchaseId, logisticsExpense: { is: null } },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) {
      await this.prisma.cargoPayable.update({
        where: { id: existing.id },
        data: { amountKgs, paidAmountKgs, remainingAmountKgs, status },
      });
      return;
    }
    await this.prisma.cargoPayable.create({
      data: {
        purchaseId: row.purchaseId,
        amountKgs,
        paidAmountKgs,
        remainingAmountKgs,
        status,
        currency: 'KGS',
      },
    });
  }

  private async upsertLegacyTransportPayable(
    row: PurchaseApAggregate & { type: 'CHINA_INTERNAL_TRANSPORT' | 'KYRGYZSTAN_INTERNAL_TRANSPORT' },
  ) {
    const linked = await this.prisma.purchaseLogisticsExpense.findMany({
      where: { purchaseId: row.purchaseId, type: row.type, transportPayableId: { not: null } },
      select: { remainingAmountKgs: true, amountKgs: true, paidAmountKgs: true },
    });
    const linkedRemaining = linked.reduce(
      (sum, item) => sum.plus(roundMoney(item.remainingAmountKgs)),
      roundMoney(0),
    );
    const residual = roundMoney(row.remainingKgs).minus(linkedRemaining);
    const residualRecognized = roundMoney(row.recognizedKgs).minus(
      linked.reduce((sum, item) => sum.plus(roundMoney(item.amountKgs)), roundMoney(0)),
    );
    const residualPaid = roundMoney(row.paidKgs).minus(
      linked.reduce((sum, item) => sum.plus(roundMoney(item.paidAmountKgs)), roundMoney(0)),
    );
    if (!residualRecognized.gt(0) && !residual.gt(0)) return;

    const amountKgs = moneyStr(residualRecognized.gt(0) ? residualRecognized : residual.plus(residualPaid));
    const paidAmountKgs = moneyStr(residualPaid.gte(0) ? residualPaid : 0);
    const remainingAmountKgs = moneyStr(residual.gte(0) ? residual : 0);
    const status = payableStatusFromAmounts(amountKgs, paidAmountKgs) as PayableStatus;

    const existing = await this.prisma.transportPayable.findFirst({
      where: { purchaseId: row.purchaseId, type: row.type, logisticsExpense: { is: null } },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) {
      await this.prisma.transportPayable.update({
        where: { id: existing.id },
        data: { amountKgs, paidAmountKgs, remainingAmountKgs, status },
      });
      return;
    }
    await this.prisma.transportPayable.create({
      data: {
        purchaseId: row.purchaseId,
        type: row.type,
        amountKgs,
        originalAmount: amountKgs,
        paidAmountKgs,
        remainingAmountKgs,
        status,
        currency: 'KGS',
      },
    });
  }

  chartCodes() {
    return {
      supplier: ACCOUNT_CODE.SUPPLIER_AP,
      cargo: ACCOUNT_CODE.CARGO_AP,
      transport: ACCOUNT_CODE.TRANSPORT_AP,
    };
  }
}
