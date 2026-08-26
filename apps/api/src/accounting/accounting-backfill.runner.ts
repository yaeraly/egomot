import {
  AccountingSourceType,
  ClientDebtTransactionType,
  InventoryMovementType,
  LogisticsType,
  PayableStatus,
  PrismaClient,
  PurchaseReceiptStatus,
  JournalStatus,
} from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { publicDecimal } from '../common/decimal.util';
import { moneyStr, roundMoney, dec } from '../purchases/purchase-calc';
import {
  ACCOUNT_CODE,
  OPENING_INVESTOR_CAPITAL_SOURCE_ID,
  UNSPECIFIED_CARGO_VENDOR_NAME,
} from './accounting-codes';
import {
  parseBackfillArgs,
  planHistoricalBackfill,
  formatHistoricalBackfillReport,
  evaluateBackfillStatus,
  isBackfillApplyAllowed,
  purchaseRecognitionAmounts,
  BACKFILL_SALE_STATUSES,
  type BackfillEvaluationStatus,
  type BackfillPurchaseInput,
  type BackfillSaleInput,
  type HistoricalBackfillSnapshot,
  type PlannedBackfillJournal,
} from './accounting-backfill.logic';
import {
  reconcileHistoricalSales,
  type DbSaleLineInput,
} from './accounting-sales-reconciliation.logic';
import {
  remainingPayableAmount,
  payableStatusFromAmounts,
} from './accounting-journal.logic';
import { persistPostedJournal } from './accounting-journal.store';
import {
  WALK_IN_CUSTOMER_NAME,
  WALK_IN_CUSTOMER_PHONE,
} from '../sales/historical-sales-import.logic';

export type BackfillApplyResult = {
  created: number;
  skippedDuplicates: number;
  report: string;
  status: BackfillEvaluationStatus;
  dryRun: boolean;
};

function key(sourceType: string, sourceId: string) {
  return `${sourceType}:${sourceId}`;
}

function loadHistoricalSalesTsvContent(): string {
  const candidates = [
    path.join(process.cwd(), 'prisma/data/historical-sales.tsv'),
    path.join(__dirname, '../../prisma/data/historical-sales.tsv'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return fs.readFileSync(candidate, 'utf8');
    }
  }
  return '';
}

export async function loadHistoricalBackfillSnapshot(
  prisma: PrismaClient,
): Promise<HistoricalBackfillSnapshot> {
  const [
    sales,
    purchases,
    journals,
    opening,
    walletSum,
    inventorySum,
    arSum,
    purchaseItemCount,
    postedInventoryLines,
    movementReceiptSum,
    movementSaleSum,
    movementByType,
  ] = await Promise.all([
      prisma.sale.findMany({
        include: {
          client: true,
          items: { include: { product: true } },
          payments: { include: { paymentMethod: true, debtTransaction: true } },
          debtTransactions: true,
        },
        orderBy: { saleDate: 'asc' },
      }),
      prisma.purchase.findMany({
        include: {
          receipts: true,
          purchasePayments: {
            include: { paymentAccount: { include: { paymentMethod: true } } },
          },
          cargoPayables: {
            include: {
              payments: {
                include: { paymentAccount: { include: { paymentMethod: true } } },
              },
            },
          },
          logistics: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.journal.findMany({
        where: {
          status: JournalStatus.POSTED,
          sourceType: {
            in: [
              AccountingSourceType.SALE,
              AccountingSourceType.SALE_REVENUE,
              AccountingSourceType.SALE_COGS,
              AccountingSourceType.SALE_DEBT_PAYMENT,
              AccountingSourceType.PURCHASE,
              AccountingSourceType.PURCHASE_RECEIPT,
              AccountingSourceType.PURCHASE_PAYMENT,
              AccountingSourceType.CARGO,
              AccountingSourceType.CARGO_PAYMENT,
              AccountingSourceType.LOGISTICS_CHINA,
              AccountingSourceType.LOGISTICS_KYRGYZSTAN,
              AccountingSourceType.AP_RECLASS,
            ],
          },
        },
        select: { sourceType: true, sourceId: true },
      }),
      prisma.journal.findFirst({
        where: {
          status: JournalStatus.POSTED,
          sourceType: AccountingSourceType.OPENING_BALANCE,
          sourceId: OPENING_INVESTOR_CAPITAL_SOURCE_ID,
        },
        include: { lines: { include: { account: true } } },
      }),
      prisma.financialTransaction.aggregate({ _sum: { amountKgs: true } }),
      prisma.inventory.aggregate({ _sum: { totalValueKgs: true } }),
      prisma.sale.aggregate({
        where: { status: { in: ['CONFIRMED', 'COMPLETED'] } },
        _sum: { debtAmountKgs: true },
      }),
      prisma.purchaseItem.count(),
      prisma.journalLine.aggregate({
        where: {
          account: { code: ACCOUNT_CODE.INVENTORY },
          journal: { status: JournalStatus.POSTED },
        },
        _sum: { debitKgs: true, creditKgs: true },
      }),
      prisma.inventoryMovement.aggregate({
        where: { type: InventoryMovementType.PURCHASE_RECEIPT },
        _sum: { totalCost: true },
      }),
      prisma.inventoryMovement.aggregate({
        where: { type: InventoryMovementType.SALE },
        _sum: { totalCost: true },
      }),
      prisma.inventoryMovement.groupBy({
        by: ['type'],
        _count: { _all: true },
        _sum: { totalCost: true },
      }),
    ]);

  const posted = new Set(journals.map((row) => key(row.sourceType, row.sourceId)));

  const saleInputs: BackfillSaleInput[] = sales.map((sale) => ({
    id: sale.id,
    number: sale.number,
    status: sale.status,
    totalAmountKgs: publicDecimal(sale.totalAmountKgs),
    paidAmountKgs: publicDecimal(sale.paidAmountKgs),
    debtAmountKgs: publicDecimal(sale.debtAmountKgs),
    saleDate: sale.saleDate,
    isWalkIn:
      sale.client.name === WALK_IN_CUSTOMER_NAME ||
      sale.client.phone === WALK_IN_CUSTOMER_PHONE,
    items: sale.items.map((item) => ({
      quantity: publicDecimal(item.quantity),
      unitCostKgs: publicDecimal(item.unitCostKgs),
    })),
    payments: sale.payments.map((payment) => ({
      id: payment.id,
      amountKgs: publicDecimal(payment.amountKgs),
      paymentMethodCode: payment.paymentMethod.code,
      isDebtCollection:
        payment.debtTransaction?.type === ClientDebtTransactionType.DEBT_PAYMENT ||
        sale.debtTransactions.some(
          (row) =>
            row.paymentId === payment.id &&
            row.type === ClientDebtTransactionType.DEBT_PAYMENT,
        ),
    })),
    alreadyPosted: {
      liveSale: posted.has(key(AccountingSourceType.SALE, sale.id)),
      revenue: posted.has(key(AccountingSourceType.SALE_REVENUE, sale.id)),
      cogs: posted.has(key(AccountingSourceType.SALE_COGS, sale.id)),
      debtPaymentIds: sale.payments
        .filter((payment) =>
          posted.has(key(AccountingSourceType.SALE_DEBT_PAYMENT, payment.id)),
        )
        .map((payment) => payment.id),
    },
  }));

  const purchaseInputs: BackfillPurchaseInput[] = purchases.map((purchase) => {
    const completedReceipts = purchase.receipts
      .filter((receipt) => receipt.status === PurchaseReceiptStatus.COMPLETED)
      .map((receipt) => ({
        id: receipt.id,
        totalLandedCostKgs: publicDecimal(receipt.totalLandedCostKgs),
        cargoKgs: publicDecimal(receipt.cargoKgs),
        alreadyPostedReceipt: posted.has(
          key(AccountingSourceType.PURCHASE_RECEIPT, receipt.id),
        ),
      }));
    const cargoPayments = purchase.cargoPayables.flatMap((payable) =>
      payable.payments.map((payment) => ({
        id: payment.id,
        amountKgs: publicDecimal(payment.amountKgs),
        paymentMethodCode: payment.paymentAccount.paymentMethod.code,
      })),
    );
    return {
      id: purchase.id,
      number: purchase.number,
      status: purchase.status,
      supplierId: purchase.supplierId,
      estimatedTotalLandedCostKgs: publicDecimal(purchase.estimatedTotalLandedCostKgs),
      totalCargoKgs: publicDecimal(purchase.totalCargoKgs),
      totalChinaTransportKgs: publicDecimal(purchase.totalChinaTransportKgs),
      totalKgInternalTransportKgs: publicDecimal(purchase.totalKgInternalTransportKgs),
      purchaseDate: purchase.purchaseDate,
      completedReceipts,
      purchasePayments: purchase.purchasePayments.map((payment) => ({
        id: payment.id,
        amountKgs: publicDecimal(payment.amountKgs),
        paymentMethodCode: payment.paymentAccount.paymentMethod.code,
      })),
      cargoPayments,
      alreadyPosted: {
        purchase: posted.has(key(AccountingSourceType.PURCHASE, purchase.id)),
        cargo: posted.has(key(AccountingSourceType.CARGO, purchase.id)),
        china:
          posted.has(key(AccountingSourceType.LOGISTICS_CHINA, purchase.id)) ||
          purchase.logistics.some(
            (row) =>
              row.type === 'CHINA_INTERNAL_TRANSPORT' &&
              posted.has(key(AccountingSourceType.LOGISTICS_CHINA, row.id)),
          ),
        kyrgyzstan:
          posted.has(key(AccountingSourceType.LOGISTICS_KYRGYZSTAN, purchase.id)) ||
          purchase.logistics.some(
            (row) =>
              row.type === 'KYRGYZSTAN_INTERNAL_TRANSPORT' &&
              posted.has(key(AccountingSourceType.LOGISTICS_KYRGYZSTAN, row.id)),
          ),
        paymentIds: purchase.purchasePayments
          .filter((payment) =>
            posted.has(key(AccountingSourceType.PURCHASE_PAYMENT, payment.id)),
          )
          .map((payment) => payment.id),
        cargoPaymentIds: cargoPayments
          .filter((payment) =>
            posted.has(key(AccountingSourceType.CARGO_PAYMENT, payment.id)),
          )
          .map((payment) => payment.id),
      },
    };
  });

  let openingCapitalPostedKgs: string | null = null;
  if (opening) {
    const cash = opening.lines
      .filter((line) => line.account.code === '1000')
      .reduce(
        (sum, line) => sum.plus(dec(line.debitKgs)).minus(dec(line.creditKgs)),
        dec(0),
      );
    openingCapitalPostedKgs = moneyStr(cash);
  }

  const saleItemCount = saleInputs.reduce((sum, sale) => sum + sale.items.length, 0);
  const saleQuantity = saleInputs.reduce(
    (sum, sale) =>
      sum.plus(
        sale.items.reduce((itemSum, item) => itemSum.plus(dec(item.quantity)), dec(0)),
      ),
    dec(0),
  );
  const postedGlInventory = dec(postedInventoryLines._sum.debitKgs ?? 0).minus(
    dec(postedInventoryLines._sum.creditKgs ?? 0),
  );

  const reconcilableSales = sales.filter((sale) => BACKFILL_SALE_STATUSES.has(sale.status));
  const dbLines: DbSaleLineInput[] = reconcilableSales.flatMap((sale) =>
    sale.items.map((item) => ({
      saleId: sale.id,
      saleNumber: sale.number,
      saleDate: sale.saleDate,
      customerName: sale.client.name,
      customerPhone: sale.client.phone,
      productName: item.product.name,
      quantity: publicDecimal(item.quantity),
      unitPriceKgs: publicDecimal(item.unitPriceKgs),
      lineTotalKgs: publicDecimal(item.lineTotalKgs),
      idempotencyKey: sale.idempotencyKey,
    })),
  );
  const dbRevenue = reconcilableSales.reduce(
    (sum, sale) => sum.plus(dec(sale.totalAmountKgs)),
    dec(0),
  );
  const salesReconciliation = reconcileHistoricalSales({
    tsvContent: loadHistoricalSalesTsvContent(),
    dbLines,
    dbSaleCount: reconcilableSales.length,
    dbRevenueKgs: moneyStr(dbRevenue),
  });

  const knownMovementTypes = new Set<string>([
    InventoryMovementType.PURCHASE_RECEIPT,
    InventoryMovementType.SALE,
  ]);
  const otherMovements = movementByType.filter((row) => !knownMovementTypes.has(row.type));
  const movementOtherValue = otherMovements.reduce(
    (sum, row) => sum.plus(dec(row._sum.totalCost ?? 0)),
    dec(0),
  );

  return {
    sales: saleInputs,
    purchases: purchaseInputs,
    openingCapitalPostedKgs,
    operationalWalletComputedKgs: moneyStr(walletSum._sum.amountKgs ?? 0),
    operationalInventoryKgs: moneyStr(inventorySum._sum.totalValueKgs ?? 0),
    operationalArKgs: moneyStr(arSum._sum.debtAmountKgs ?? 0),
    postedGlInventoryKgs: moneyStr(postedGlInventory),
    reliableOpeningInventoryKgs: null,
    saleItemCount: String(saleItemCount),
    saleQuantity: saleQuantity.toFixed(3),
    purchaseItemCount: String(purchaseItemCount),
    movementPurchaseReceiptValueKgs: moneyStr(movementReceiptSum._sum.totalCost ?? 0),
    movementSaleValueKgs: moneyStr(movementSaleSum._sum.totalCost ?? 0),
    movementOtherValueKgs: moneyStr(movementOtherValue),
    movementOtherTypes:
      otherMovements.length > 0 ? otherMovements.map((row) => row.type).join(',') : 'none',
    hasOpeningInventoryMovement: false,
    hasInventoryAdjustmentMovement: false,
    enforceSalesControlTotals: true,
    salesReconciliation,
  };
}

async function ensureSupplierPayable(
  prisma: PrismaClient,
  purchase: BackfillPurchaseInput,
  journalId: string,
) {
  const amounts = purchaseRecognitionAmounts(purchase);
  if (!amounts.supplier.gt(0)) return;
  const existing = await prisma.supplierPayable.findUnique({
    where: { purchaseId: purchase.id },
  });
  if (existing) return;
  await prisma.supplierPayable.create({
    data: {
      supplierId: purchase.supplierId,
      purchaseId: purchase.id,
      amountKgs: moneyStr(amounts.supplier),
      paidAmountKgs: '0.00',
      remainingAmountKgs: moneyStr(amounts.supplier),
      status: PayableStatus.UNPAID,
      journalId,
    },
  });
}

async function ensureCargoPayable(
  prisma: PrismaClient,
  purchase: BackfillPurchaseInput,
  journalId: string,
) {
  const amounts = purchaseRecognitionAmounts(purchase);
  if (!amounts.cargo.gt(0)) return;
  const existing = await prisma.cargoPayable.findFirst({
    where: { purchaseId: purchase.id },
  });
  if (existing) return;
  const vendor = await prisma.cargoVendor.findFirst({
    where: { name: UNSPECIFIED_CARGO_VENDOR_NAME },
  });
  await prisma.cargoPayable.create({
    data: {
      cargoVendorId: vendor?.id ?? null,
      purchaseId: purchase.id,
      amountKgs: moneyStr(amounts.cargo),
      paidAmountKgs: '0.00',
      remainingAmountKgs: moneyStr(amounts.cargo),
      status: PayableStatus.UNPAID,
      journalId,
    },
  });
}

async function ensureTransportPayable(
  prisma: PrismaClient,
  purchase: BackfillPurchaseInput,
  type: 'CHINA_INTERNAL_TRANSPORT' | 'KYRGYZSTAN_INTERNAL_TRANSPORT',
  journalId: string,
) {
  const amounts = purchaseRecognitionAmounts(purchase);
  const amount = type === 'CHINA_INTERNAL_TRANSPORT' ? amounts.china : amounts.kyrgyzstan;
  if (!amount.gt(0)) return;
  const existing = await prisma.transportPayable.findFirst({
    where: { purchaseId: purchase.id, type },
  });
  if (existing) return;
  await prisma.transportPayable.create({
    data: {
      purchaseId: purchase.id,
      type: type as LogisticsType,
      amountKgs: moneyStr(amount),
      originalAmount: moneyStr(amount),
      paidAmountKgs: '0.00',
      remainingAmountKgs: moneyStr(amount),
      status: PayableStatus.UNPAID,
      journalId,
      currency: 'KGS',
    },
  });
}

async function applyVerifiedPayablePayment(
  prisma: PrismaClient,
  kind: 'supplier' | 'cargo',
  purchaseId: string,
  amountKgs: string,
) {
  if (kind === 'supplier') {
    const row = await prisma.supplierPayable.findUnique({ where: { purchaseId } });
    if (!row) return;
    const newPaid = roundMoney(dec(row.paidAmountKgs).plus(amountKgs));
    const remaining = remainingPayableAmount(row.amountKgs, newPaid);
    await prisma.supplierPayable.update({
      where: { id: row.id },
      data: {
        paidAmountKgs: moneyStr(newPaid),
        remainingAmountKgs: moneyStr(remaining),
        status: payableStatusFromAmounts(row.amountKgs, newPaid) as PayableStatus,
      },
    });
    return;
  }
  const row = await prisma.cargoPayable.findFirst({
    where: { purchaseId },
    orderBy: { createdAt: 'asc' },
  });
  if (!row) return;
  const newPaid = roundMoney(dec(row.paidAmountKgs).plus(amountKgs));
  const remaining = remainingPayableAmount(row.amountKgs, newPaid);
  await prisma.cargoPayable.update({
    where: { id: row.id },
    data: {
      paidAmountKgs: moneyStr(newPaid),
      remainingAmountKgs: moneyStr(remaining),
      status: payableStatusFromAmounts(row.amountKgs, newPaid) as PayableStatus,
    },
  });
}

export async function applyHistoricalBackfill(
  prisma: PrismaClient,
  planned: PlannedBackfillJournal[],
  purchasesById: Map<string, BackfillPurchaseInput>,
  createdByUserId: string,
): Promise<{ created: number; skippedDuplicates: number }> {
  let created = 0;
  let skippedDuplicates = 0;

  for (const journal of planned) {
    const existing = await prisma.journal.findFirst({
      where: {
        sourceType: journal.sourceType as AccountingSourceType,
        sourceId: journal.sourceId,
        status: JournalStatus.POSTED,
      },
    });
    if (existing) {
      skippedDuplicates += 1;
      continue;
    }

    const posted = await persistPostedJournal(prisma, {
      sourceType: journal.sourceType as AccountingSourceType,
      sourceId: journal.sourceId,
      memo: journal.memo,
      lines: journal.lines,
      createdByUserId,
      postedAt: journal.postedAt,
    });
    created += 1;

    const purchase = journal.purchaseId ? purchasesById.get(journal.purchaseId) : undefined;
    if (journal.sourceType === 'PURCHASE' && purchase) {
      await ensureSupplierPayable(prisma, purchase, posted.id);
    }
    if (journal.sourceType === 'CARGO' && purchase) {
      await ensureCargoPayable(prisma, purchase, posted.id);
    }
    if (
      (journal.sourceType === 'LOGISTICS_CHINA' || journal.sourceType === 'LOGISTICS_KYRGYZSTAN') &&
      purchase
    ) {
      await ensureTransportPayable(
        prisma,
        purchase,
        journal.sourceType === 'LOGISTICS_CHINA'
          ? 'CHINA_INTERNAL_TRANSPORT'
          : 'KYRGYZSTAN_INTERNAL_TRANSPORT',
        posted.id,
      );
    }
    if (journal.sourceType === 'PURCHASE_PAYMENT' && journal.purchaseId && journal.lines[0]) {
      await applyVerifiedPayablePayment(
        prisma,
        'supplier',
        journal.purchaseId,
        journal.lines[0].debitKgs,
      );
    }
    if (journal.sourceType === 'CARGO_PAYMENT' && journal.purchaseId && journal.lines[0]) {
      await applyVerifiedPayablePayment(
        prisma,
        'cargo',
        journal.purchaseId,
        journal.lines[0].debitKgs,
      );
    }
  }

  return { created, skippedDuplicates };
}

export async function runHistoricalBackfill(
  prisma: PrismaClient,
  argv: string[],
): Promise<BackfillApplyResult> {
  const { selection, dryRun, mode } = parseBackfillArgs(argv);
  const snapshot = await loadHistoricalBackfillSnapshot(prisma);
  const plan = planHistoricalBackfill(snapshot, selection);
  const evaluation = evaluateBackfillStatus(plan, mode);
  let created = 0;
  let skippedDuplicates = plan.totals.skippedCount;

  if (isBackfillApplyAllowed(evaluation, dryRun)) {
    const owner = await prisma.user.findFirst({
      where: { role: 'OWNER', isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) {
      throw new Error('Historical backfill requires an OWNER user');
    }
    const purchasesById = new Map(snapshot.purchases.map((row) => [row.id, row]));
    const applied = await applyHistoricalBackfill(
      prisma,
      plan.planned,
      purchasesById,
      owner.id,
    );
    created = applied.created;
    skippedDuplicates += applied.skippedDuplicates;
  }

  const extra = [
    '',
    dryRun ? 'Dry run: no journals created.' : `Journals created: ${created}`,
    `Duplicates skipped: ${skippedDuplicates}`,
    snapshot.openingCapitalPostedKgs
      ? `Opening capital journal found: ${snapshot.openingCapitalPostedKgs}`
      : 'Opening capital journal NOT found (not created by this command).',
    `Computed operational wallet: ${snapshot.operationalWalletComputedKgs}`,
    `Posted GL Inventory 1200: ${snapshot.postedGlInventoryKgs}`,
    `InventoryMovement PURCHASE_RECEIPT value: ${snapshot.movementPurchaseReceiptValueKgs}`,
    `InventoryMovement SALE value: ${snapshot.movementSaleValueKgs}`,
    'Opening investor capital was not posted by this command.',
    'Purchase.status=PAID was not treated as cash evidence.',
    '9,167,215 operational wallet was not used as opening cash or a plug.',
    'No fake cash, supplier payment, or cargo payment journals were invented.',
    evaluation.status === 'PASS'
      ? 'Inventory reconciles; posting is allowed when not a dry-run.'
      : 'Do not post: inventory difference != 0 or another blocker is present.',
  ];

  return {
    created,
    skippedDuplicates,
    report: `${formatHistoricalBackfillReport(plan, mode)}\n${extra.join('\n')}`,
    status: evaluation.status,
    dryRun,
  };
}
