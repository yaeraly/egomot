import { moneyStr, roundMoney, Decimal } from '../purchases/purchase-calc';
import {
  OPENING_INVESTOR_CAPITAL_KGS,
  OPERATIONAL_WALLET_STATED_KGS,
  glCashAccountCodeForPaymentMethod,
} from './accounting-codes';
import {
  buildCargoPayableLines,
  buildCargoPaymentLines,
  buildCogsInventoryLines,
  buildCreditPurchaseLines,
  buildDebtCollectionLines,
  buildSaleRevenueLines,
  buildSupplierApPaymentLines,
  debitNormalBalance,
  remainingPayableAmount,
  saleCogsFromItems,
  validateJournalLines,
  grossCredit,
  grossDebit,
  type JournalLineDraft,
} from './accounting-journal.logic';

export const BACKFILL_SALE_STATUSES = new Set(['CONFIRMED', 'COMPLETED']);

export type BackfillMode = 'sales' | 'purchases' | 'payments' | 'cargo' | 'all';

export type BackfillSelection = {
  sales: boolean;
  purchases: boolean;
  payments: boolean;
  cargo: boolean;
};

export function selectionFromMode(mode: BackfillMode | BackfillSelection): BackfillSelection {
  if (typeof mode !== 'string') return mode;
  if (mode === 'all') {
    return { sales: true, purchases: true, payments: true, cargo: true };
  }
  return {
    sales: mode === 'sales',
    purchases: mode === 'purchases',
    payments: mode === 'payments',
    cargo: mode === 'cargo',
  };
}

export function parseBackfillArgs(argv: string[]): {
  selection: BackfillSelection;
  dryRun: boolean;
  mode: BackfillMode;
} {
  const dryRun = argv.includes('--dry-run');
  const hasSpecific =
    argv.includes('--sales') ||
    argv.includes('--purchases') ||
    argv.includes('--payments') ||
    argv.includes('--cargo');
  if (argv.includes('--all') || !hasSpecific) {
    return {
      selection: selectionFromMode('all'),
      dryRun,
      mode: 'all',
    };
  }
  const selection: BackfillSelection = {
    sales: argv.includes('--sales'),
    purchases: argv.includes('--purchases'),
    payments: argv.includes('--payments'),
    cargo: argv.includes('--cargo'),
  };
  const enabled = Object.values(selection).filter(Boolean).length;
  return {
    selection,
    dryRun,
    mode: enabled === 1
      ? (argv.includes('--sales')
        ? 'sales'
        : argv.includes('--purchases')
          ? 'purchases'
          : argv.includes('--payments')
            ? 'payments'
            : 'cargo')
      : 'all',
  };
}

export type PlannedBackfillJournal = {
  sourceType:
    | 'SALE_REVENUE'
    | 'SALE_COGS'
    | 'SALE_DEBT_PAYMENT'
    | 'PURCHASE'
    | 'CARGO'
    | 'PURCHASE_PAYMENT'
    | 'CARGO_PAYMENT';
  sourceId: string;
  memo: string;
  postedAt: Date;
  lines: JournalLineDraft[];
  saleId?: string;
  purchaseId?: string;
  paymentId?: string;
};

export type BackfillSkip = {
  sourceType: string;
  sourceId: string;
  reason: string;
};

export type BackfillSalePaymentInput = {
  id: string;
  amountKgs: string;
  paymentMethodCode: string;
  isDebtCollection: boolean;
};

export type BackfillSaleInput = {
  id: string;
  number: string;
  status: string;
  totalAmountKgs: string;
  paidAmountKgs: string;
  debtAmountKgs: string;
  saleDate: Date;
  isWalkIn: boolean;
  items: Array<{ quantity: string; unitCostKgs: string }>;
  payments: BackfillSalePaymentInput[];
  alreadyPosted: {
    liveSale: boolean;
    revenue: boolean;
    cogs: boolean;
    debtPaymentIds: string[];
  };
};

export type BackfillPurchaseInput = {
  id: string;
  number: string;
  status: string;
  supplierId: string;
  estimatedTotalLandedCostKgs: string;
  totalCargoKgs: string;
  purchaseDate: Date | null;
  completedReceipts: Array<{
    id: string;
    totalLandedCostKgs: string;
    cargoKgs: string;
    alreadyPostedReceipt: boolean;
  }>;
  purchasePayments: Array<{
    id: string;
    amountKgs: string;
    paymentMethodCode: string;
  }>;
  cargoPayments: Array<{
    id: string;
    amountKgs: string;
    paymentMethodCode: string;
  }>;
  alreadyPosted: {
    purchase: boolean;
    cargo: boolean;
    paymentIds: string[];
    cargoPaymentIds: string[];
  };
};

export type HistoricalBackfillSnapshot = {
  sales: BackfillSaleInput[];
  purchases: BackfillPurchaseInput[];
  openingCapitalPostedKgs?: string | null;
  operationalWalletComputedKgs?: string | null;
  operationalInventoryKgs?: string | null;
  operationalArKgs?: string | null;
};

export type HistoricalBackfillPlan = {
  planned: PlannedBackfillJournal[];
  skipped: BackfillSkip[];
  issues: string[];
  totals: HistoricalBackfillTotals;
};

export type HistoricalBackfillTotals = {
  saleCount: string;
  revenueKgs: string;
  cashSalesKgs: string;
  creditSalesKgs: string;
  arBookedKgs: string;
  cogsKgs: string;
  purchaseCount: string;
  purchasesWithoutReceiptCount: string;
  inventoryInKgs: string;
  supplierApKgs: string;
  verifiedSupplierPaymentsKgs: string;
  cargoTotalKgs: string;
  cargoApKgs: string;
  verifiedCargoPaymentsKgs: string;
  openingInvestorCapitalKgs: string;
  verifiedCashInKgs: string;
  verifiedCashOutKgs: string;
  accountingCashKgs: string;
  operationalWalletStatedKgs: string;
  operationalWalletComputedKgs: string;
  cashReconciliationGapKgs: string;
  operationalInventoryKgs: string;
  glInventoryKgs: string;
  inventoryDifferenceKgs: string;
  operationalArKgs: string;
  glArKgs: string;
  arDifferenceKgs: string;
  totalApKgs: string;
  plannedJournalCount: number;
  skippedCount: number;
  inventedPaymentAttempts: number;
};

function zero(): Decimal {
  return roundMoney(0);
}

export function isBackfillableSale(status: string): boolean {
  return BACKFILL_SALE_STATUSES.has(status);
}

export function splitLandedCost(params: {
  landedKgs: Decimal.Value;
  cargoKgs: Decimal.Value;
}): { landed: Decimal; cargo: Decimal; supplier: Decimal } {
  const landed = roundMoney(params.landedKgs);
  const cargo = roundMoney(Decimal.min(landed, Decimal.max(0, roundMoney(params.cargoKgs))));
  const supplier = remainingPayableAmount(landed, cargo);
  return { landed, cargo, supplier };
}

export function purchaseRecognitionAmounts(purchase: BackfillPurchaseInput): {
  landed: Decimal;
  cargo: Decimal;
  supplier: Decimal;
  usedReceipts: boolean;
  liveReceiptAlreadyPosted: boolean;
} {
  const completed = purchase.completedReceipts;
  if (completed.length > 0) {
    const landed = roundMoney(
      completed.reduce((sum, row) => sum.plus(roundMoney(row.totalLandedCostKgs)), zero()),
    );
    const cargo = roundMoney(
      completed.reduce((sum, row) => sum.plus(roundMoney(row.cargoKgs)), zero()),
    );
    const split = splitLandedCost({ landedKgs: landed, cargoKgs: cargo });
    return {
      ...split,
      usedReceipts: true,
      liveReceiptAlreadyPosted: completed.some((row) => row.alreadyPostedReceipt),
    };
  }
  const split = splitLandedCost({
    landedKgs: purchase.estimatedTotalLandedCostKgs,
    cargoKgs: purchase.totalCargoKgs,
  });
  return { ...split, usedReceipts: false, liveReceiptAlreadyPosted: false };
}

/** Purchase.status=PAID is not payment evidence. Only explicit payment documents count. */
export function verifiedSupplierPaymentTotal(
  purchase: Pick<BackfillPurchaseInput, 'status' | 'purchasePayments'>,
): Decimal {
  void purchase.status;
  return roundMoney(
    purchase.purchasePayments.reduce((sum, row) => sum.plus(roundMoney(row.amountKgs)), zero()),
  );
}

export function verifiedCargoPaymentTotal(
  purchase: Pick<BackfillPurchaseInput, 'cargoPayments'>,
): Decimal {
  return roundMoney(
    purchase.cargoPayments.reduce((sum, row) => sum.plus(roundMoney(row.amountKgs)), zero()),
  );
}

function cashByMethod(payments: Array<{ amountKgs: string; paymentMethodCode: string }>) {
  const byCode: Record<string, string> = {};
  for (const payment of payments) {
    const code = glCashAccountCodeForPaymentMethod(payment.paymentMethodCode);
    const current = roundMoney(byCode[code] ?? 0);
    byCode[code] = moneyStr(current.plus(roundMoney(payment.amountKgs)));
  }
  return byCode;
}

function pushJournal(
  planned: PlannedBackfillJournal[],
  skipped: BackfillSkip[],
  issues: string[],
  journal: PlannedBackfillJournal,
  alreadyPosted: boolean,
) {
  if (alreadyPosted) {
    skipped.push({
      sourceType: journal.sourceType,
      sourceId: journal.sourceId,
      reason: 'already posted',
    });
    return;
  }
  try {
    validateJournalLines(journal.lines);
    planned.push(journal);
  } catch (error) {
    issues.push(
      `${journal.sourceType}:${journal.sourceId} ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function planHistoricalBackfill(
  snapshot: HistoricalBackfillSnapshot,
  mode: BackfillMode | BackfillSelection,
): HistoricalBackfillPlan {
  const planned: PlannedBackfillJournal[] = [];
  const skipped: BackfillSkip[] = [];
  const issues: string[] = [];
  let inventedPaymentAttempts = 0;
  const selection = selectionFromMode(mode);
  const doSales = selection.sales;
  const doPurchases = selection.purchases;
  const doCargo = selection.cargo;
  const doPayments = selection.payments;

  if (doPurchases || doCargo || doPayments) {
    for (const purchase of snapshot.purchases) {
      const amounts = purchaseRecognitionAmounts(purchase);
      const verifiedSupplier = verifiedSupplierPaymentTotal(purchase);
      const postedAt = purchase.purchaseDate ?? new Date();

      if (purchase.status === 'PAID' && verifiedSupplier.eq(0)) {
        inventedPaymentAttempts += 1;
      }

      if (doPurchases && amounts.supplier.gt(0)) {
        if (amounts.liveReceiptAlreadyPosted) {
          skipped.push({
            sourceType: 'PURCHASE',
            sourceId: purchase.id,
            reason: 'live PURCHASE_RECEIPT journal already posted',
          });
        } else {
          pushJournal(
            planned,
            skipped,
            issues,
            {
              sourceType: 'PURCHASE',
              sourceId: purchase.id,
              purchaseId: purchase.id,
              memo: `Historical purchase ${purchase.number}`,
              postedAt,
              lines: buildCreditPurchaseLines(amounts.supplier),
            },
            purchase.alreadyPosted.purchase,
          );
        }
      }

      if (doCargo && amounts.cargo.gt(0)) {
        if (amounts.liveReceiptAlreadyPosted) {
          skipped.push({
            sourceType: 'CARGO',
            sourceId: purchase.id,
            reason: 'live PURCHASE_RECEIPT journal already posted',
          });
        } else {
          pushJournal(
            planned,
            skipped,
            issues,
            {
              sourceType: 'CARGO',
              sourceId: purchase.id,
              purchaseId: purchase.id,
              memo: `Historical cargo ${purchase.number}`,
              postedAt,
              lines: buildCargoPayableLines(amounts.cargo),
            },
            purchase.alreadyPosted.cargo,
          );
        }
      }

      if (doPayments) {
        for (const payment of purchase.purchasePayments) {
          pushJournal(
            planned,
            skipped,
            issues,
            {
              sourceType: 'PURCHASE_PAYMENT',
              sourceId: payment.id,
              purchaseId: purchase.id,
              paymentId: payment.id,
              memo: `Verified historical supplier payment ${purchase.number}`,
              postedAt,
              lines: buildSupplierApPaymentLines({
                amountKgs: payment.amountKgs,
                cashAccountCode: glCashAccountCodeForPaymentMethod(payment.paymentMethodCode),
              }),
            },
            purchase.alreadyPosted.paymentIds.includes(payment.id),
          );
        }
        for (const payment of purchase.cargoPayments) {
          pushJournal(
            planned,
            skipped,
            issues,
            {
              sourceType: 'CARGO_PAYMENT',
              sourceId: payment.id,
              purchaseId: purchase.id,
              paymentId: payment.id,
              memo: `Verified historical cargo payment ${purchase.number}`,
              postedAt,
              lines: buildCargoPaymentLines({
                amountKgs: payment.amountKgs,
                cashAccountCode: glCashAccountCodeForPaymentMethod(payment.paymentMethodCode),
              }),
            },
            purchase.alreadyPosted.cargoPaymentIds.includes(payment.id),
          );
        }
      }
    }
  }

  if (doSales || doPayments) {
    for (const sale of snapshot.sales) {
      if (!isBackfillableSale(sale.status)) {
        skipped.push({
          sourceType: 'SALE',
          sourceId: sale.id,
          reason: `status ${sale.status} is not backfillable`,
        });
        continue;
      }

      const salePayments = sale.payments.filter((row) => !row.isDebtCollection);
      const collectionPayments = sale.payments.filter((row) => row.isDebtCollection);
      const revenue = roundMoney(sale.totalAmountKgs);
      const cogs = saleCogsFromItems(sale.items);

      if (doSales) {
        const skipBecauseLive = sale.alreadyPosted.liveSale;
        if (revenue.gt(0)) {
          const cashByAccountCode = cashByMethod(salePayments);
          pushJournal(
            planned,
            skipped,
            issues,
            {
              sourceType: 'SALE_REVENUE',
              sourceId: sale.id,
              saleId: sale.id,
              memo: `Historical sale revenue ${sale.number}`,
              postedAt: sale.saleDate,
              lines: buildSaleRevenueLines({
                revenueKgs: revenue,
                cashByAccountCode,
              }),
            },
            skipBecauseLive || sale.alreadyPosted.revenue,
          );
        }
        if (cogs.gt(0)) {
          pushJournal(
            planned,
            skipped,
            issues,
            {
              sourceType: 'SALE_COGS',
              sourceId: sale.id,
              saleId: sale.id,
              memo: `Historical sale COGS ${sale.number}`,
              postedAt: sale.saleDate,
              lines: buildCogsInventoryLines(cogs),
            },
            skipBecauseLive || sale.alreadyPosted.cogs,
          );
        }
      }

      if (doPayments) {
        for (const payment of collectionPayments) {
          pushJournal(
            planned,
            skipped,
            issues,
            {
              sourceType: 'SALE_DEBT_PAYMENT',
              sourceId: payment.id,
              saleId: sale.id,
              paymentId: payment.id,
              memo: `Historical customer debt collection ${sale.number}`,
              postedAt: sale.saleDate,
              lines: buildDebtCollectionLines({
                amountKgs: payment.amountKgs,
                cashAccountCode: glCashAccountCodeForPaymentMethod(payment.paymentMethodCode),
              }),
            },
            sale.alreadyPosted.debtPaymentIds.includes(payment.id),
          );
        }
      }
    }
  }

  const totals = summarizeBackfillPlan({
    snapshot,
    planned,
    skipped,
    inventedPaymentAttempts,
  });

  return { planned, skipped, issues, totals };
}

export function summarizeBackfillPlan(params: {
  snapshot: HistoricalBackfillSnapshot;
  planned: PlannedBackfillJournal[];
  skipped: BackfillSkip[];
  inventedPaymentAttempts: number;
}): HistoricalBackfillTotals {
  const lines = params.planned.flatMap((row) => row.lines);
  const opening = roundMoney(
    params.snapshot.openingCapitalPostedKgs &&
      roundMoney(params.snapshot.openingCapitalPostedKgs).gt(0)
      ? params.snapshot.openingCapitalPostedKgs
      : OPENING_INVESTOR_CAPITAL_KGS,
  );

  const backfillableSales = params.snapshot.sales.filter((sale) => isBackfillableSale(sale.status));
  const revenue = roundMoney(
    backfillableSales.reduce((sum, sale) => sum.plus(roundMoney(sale.totalAmountKgs)), zero()),
  );
  const cogs = roundMoney(
    backfillableSales.reduce((sum, sale) => sum.plus(saleCogsFromItems(sale.items)), zero()),
  );

  let cashSales = zero();
  let creditSales = zero();
  let operationalAr = zero();
  for (const sale of backfillableSales) {
    const salePayments = sale.payments.filter((row) => !row.isDebtCollection);
    const verifiedCash = roundMoney(
      salePayments.reduce((sum, row) => sum.plus(roundMoney(row.amountKgs)), zero()),
    );
    const cash = Decimal.min(roundMoney(sale.totalAmountKgs), verifiedCash);
    const ar = remainingPayableAmount(sale.totalAmountKgs, cash);
    cashSales = cashSales.plus(cash);
    creditSales = creditSales.plus(ar);
    operationalAr = operationalAr.plus(roundMoney(sale.debtAmountKgs));
  }

  let inventoryIn = zero();
  let supplierApGross = zero();
  let cargoGross = zero();
  let verifiedSupplier = zero();
  let verifiedCargo = zero();
  let withoutReceipts = 0;
  for (const purchase of params.snapshot.purchases) {
    const amounts = purchaseRecognitionAmounts(purchase);
    if (!amounts.usedReceipts) withoutReceipts += 1;
    inventoryIn = inventoryIn.plus(amounts.landed);
    supplierApGross = supplierApGross.plus(amounts.supplier);
    cargoGross = cargoGross.plus(amounts.cargo);
    verifiedSupplier = verifiedSupplier.plus(verifiedSupplierPaymentTotal(purchase));
    verifiedCargo = verifiedCargo.plus(verifiedCargoPaymentTotal(purchase));
  }

  const supplierAp = remainingPayableAmount(supplierApGross, verifiedSupplier);
  const cargoAp = remainingPayableAmount(cargoGross, verifiedCargo);

  const verifiedCashIn = roundMoney(
    grossDebit(lines, '1000').plus(grossDebit(lines, '1010')),
  );
  const verifiedCashOut = roundMoney(
    grossCredit(lines, '1000').plus(grossCredit(lines, '1010')),
  );
  const accountingCash = roundMoney(opening.plus(verifiedCashIn).minus(verifiedCashOut));
  const glInventory = roundMoney(debitNormalBalance(lines, '1200'));
  const glAr = roundMoney(debitNormalBalance(lines, '1100'));
  const operationalInventory = roundMoney(params.snapshot.operationalInventoryKgs ?? 0);
  const statedWallet = roundMoney(OPERATIONAL_WALLET_STATED_KGS);
  const computedWallet = roundMoney(
    params.snapshot.operationalWalletComputedKgs ?? OPERATIONAL_WALLET_STATED_KGS,
  );

  return {
    saleCount: String(backfillableSales.length),
    revenueKgs: moneyStr(revenue),
    cashSalesKgs: moneyStr(cashSales),
    creditSalesKgs: moneyStr(creditSales),
    arBookedKgs: moneyStr(creditSales),
    cogsKgs: moneyStr(cogs),
    purchaseCount: String(params.snapshot.purchases.length),
    purchasesWithoutReceiptCount: String(withoutReceipts),
    inventoryInKgs: moneyStr(inventoryIn),
    supplierApKgs: moneyStr(supplierAp),
    verifiedSupplierPaymentsKgs: moneyStr(verifiedSupplier),
    cargoTotalKgs: moneyStr(cargoGross),
    cargoApKgs: moneyStr(cargoAp),
    verifiedCargoPaymentsKgs: moneyStr(verifiedCargo),
    openingInvestorCapitalKgs: moneyStr(opening),
    verifiedCashInKgs: moneyStr(verifiedCashIn),
    verifiedCashOutKgs: moneyStr(verifiedCashOut),
    accountingCashKgs: moneyStr(accountingCash),
    operationalWalletStatedKgs: moneyStr(statedWallet),
    operationalWalletComputedKgs: moneyStr(computedWallet),
    cashReconciliationGapKgs: moneyStr(accountingCash.minus(statedWallet)),
    operationalInventoryKgs: moneyStr(operationalInventory),
    glInventoryKgs: moneyStr(glInventory),
    inventoryDifferenceKgs: moneyStr(glInventory.minus(operationalInventory)),
    operationalArKgs: moneyStr(operationalAr),
    glArKgs: moneyStr(glAr),
    arDifferenceKgs: moneyStr(glAr.minus(operationalAr)),
    totalApKgs: moneyStr(supplierAp.plus(cargoAp)),
    plannedJournalCount: params.planned.length,
    skippedCount: params.skipped.length,
    inventedPaymentAttempts: params.inventedPaymentAttempts,
  };
}

export function evaluateBackfillStatus(
  plan: HistoricalBackfillPlan,
  mode: BackfillMode | BackfillSelection = 'all',
): {
  status: 'PASS' | 'BLOCKED';
  blockers: string[];
} {
  const blockers: string[] = [];
  const t = plan.totals;
  if (plan.issues.length > 0) {
    blockers.push(...plan.issues);
  }
  const selection = selectionFromMode(mode);
  const fullInventoryRecon = selection.sales && selection.purchases && selection.cargo;
  if (fullInventoryRecon) {
    if (!roundMoney(t.inventoryDifferenceKgs).eq(0)) {
      blockers.push(
        `Inventory GL ${t.glInventoryKgs} != operational ${t.operationalInventoryKgs} (difference ${t.inventoryDifferenceKgs})`,
      );
    }
  }
  if (selection.sales && selection.payments) {
    if (!roundMoney(t.arDifferenceKgs).eq(0)) {
      blockers.push(
        `AR GL ${t.glArKgs} != operational debt ${t.operationalArKgs} (difference ${t.arDifferenceKgs})`,
      );
    }
  }
  return {
    status: blockers.length === 0 ? 'PASS' : 'BLOCKED',
    blockers,
  };
}

export function formatHistoricalBackfillReport(
  plan: HistoricalBackfillPlan,
  mode: BackfillMode | BackfillSelection = 'all',
): string {
  const t = plan.totals;
  const evaluation = evaluateBackfillStatus(plan, mode);
  const lines = [
    '=== HISTORICAL FINANCE BACKFILL ===',
    '',
    'Sales:',
    '',
    'Source sales:',
    t.saleCount,
    '',
    'Revenue:',
    t.revenueKgs,
    '',
    'Cash sales:',
    t.cashSalesKgs,
    '',
    'Credit sales:',
    t.creditSalesKgs,
    '',
    'AR:',
    t.arBookedKgs,
    '',
    'COGS:',
    t.cogsKgs,
    '',
    '',
    'Purchases:',
    '',
    'Purchase count:',
    t.purchaseCount,
    '',
    'Inventory value:',
    t.inventoryInKgs,
    '',
    'Verified supplier payments:',
    t.verifiedSupplierPaymentsKgs,
    '',
    'Supplier AP:',
    t.supplierApKgs,
    '',
    '',
    'Cargo:',
    '',
    'Cargo total:',
    t.cargoTotalKgs,
    '',
    'Verified cargo payments:',
    t.verifiedCargoPaymentsKgs,
    '',
    'Cargo AP:',
    t.cargoApKgs,
    '',
    '',
    'Cash:',
    '',
    'Opening investor capital:',
    t.openingInvestorCapitalKgs,
    '',
    'Verified cash inflow:',
    t.verifiedCashInKgs,
    '',
    'Verified cash outflow:',
    t.verifiedCashOutKgs,
    '',
    'Accounting cash:',
    t.accountingCashKgs,
    '',
    'Operational wallet total:',
    t.operationalWalletStatedKgs,
    '',
    'Cash reconciliation gap:',
    t.cashReconciliationGapKgs,
    '',
    '',
    'Inventory:',
    '',
    'Operational inventory:',
    t.operationalInventoryKgs,
    '',
    'GL inventory:',
    t.glInventoryKgs,
    '',
    'Difference:',
    t.inventoryDifferenceKgs,
    '',
    '',
    'AR:',
    '',
    'Operational AR:',
    t.operationalArKgs,
    '',
    'GL AR:',
    t.glArKgs,
    '',
    'Difference:',
    t.arDifferenceKgs,
    '',
    '',
    'AP:',
    '',
    'Supplier AP:',
    t.supplierApKgs,
    '',
    'Cargo AP:',
    t.cargoApKgs,
    '',
    'Total AP:',
    t.totalApKgs,
    '',
    '',
    'Journals:',
    `Planned: ${t.plannedJournalCount}`,
    `Skipped (already posted / not backfillable): ${t.skippedCount}`,
    `Purchase.status=PAID without payment documents (no cash out invented): ${t.inventedPaymentAttempts}`,
    `Purchases without completed receipt: ${t.purchasesWithoutReceiptCount}`,
    '',
    'Status:',
    '',
    evaluation.status,
  ];
  if (evaluation.blockers.length > 0) {
    lines.push('', 'Blockers:');
    for (const blocker of evaluation.blockers) {
      lines.push(`- ${blocker}`);
    }
  }
  if (plan.issues.length > 0) {
    lines.push('', 'Journal validation issues:');
    for (const issue of plan.issues) {
      lines.push(`- ${issue}`);
    }
  }
  return lines.join('\n');
}
