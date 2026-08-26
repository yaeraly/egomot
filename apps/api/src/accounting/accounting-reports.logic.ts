import { Decimal, moneyStr, roundMoney } from '../purchases/purchase-calc';
import { ACCOUNT_CODE } from './accounting-codes';
import {
  creditNormalBalance,
  debitNormalBalance,
} from './accounting-journal.logic';
import {
  isCargoLogisticsCashFlowSource,
  isChinaLogisticsCashFlowSource,
  isKyrgyzstanLogisticsCashFlowSource,
} from './logistics-cost.logic';

export type PostedReportLine = {
  accountCode: string;
  debitKgs: Decimal.Value;
  creditKgs: Decimal.Value;
};

export type PostedReportJournal = {
  postedAt: Date | string;
  sourceType?: string;
  status?: string;
  lines: PostedReportLine[];
};

export type CashFlowGroupBy = 'day' | 'month' | 'range';

export const CASH_ACCOUNT_CODES = [ACCOUNT_CODE.CASH, ACCOUNT_CODE.BANK] as const;

const CASH_CODE_SET = new Set<string>(CASH_ACCOUNT_CODES);

export type CashFlowBuckets = {
  investorContributionsKgs: string;
  cashSalesKgs: string;
  customerCollectionsKgs: string;
  otherCashInKgs: string;
  supplierPaymentsKgs: string;
  chinaTransportPaymentsKgs: string;
  cargoPaymentsKgs: string;
  kyrgyzstanTransportPaymentsKgs: string;
  warehouseRentKgs: string;
  stationeryKgs: string;
  ownerSalaryKgs: string;
  ownerWithdrawalsKgs: string;
  otherCashOutKgs: string;
};

const EMPTY_CASH_FLOW: CashFlowBuckets = {
  investorContributionsKgs: '0.00',
  cashSalesKgs: '0.00',
  customerCollectionsKgs: '0.00',
  otherCashInKgs: '0.00',
  supplierPaymentsKgs: '0.00',
  chinaTransportPaymentsKgs: '0.00',
  cargoPaymentsKgs: '0.00',
  kyrgyzstanTransportPaymentsKgs: '0.00',
  warehouseRentKgs: '0.00',
  stationeryKgs: '0.00',
  ownerSalaryKgs: '0.00',
  ownerWithdrawalsKgs: '0.00',
  otherCashOutKgs: '0.00',
};

export function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function flattenJournalLines(journals: PostedReportJournal[]): Array<
  PostedReportLine & { postedAt: Date }
> {
  return journals.flatMap((journal) =>
    journal.lines.map((line) => ({
      ...line,
      postedAt: toDate(journal.postedAt),
    })),
  );
}

export function linesOnOrBefore(lines: Array<PostedReportLine & { postedAt: Date }>, asOf: Date) {
  const end = asOf.getTime();
  return lines.filter((row) => row.postedAt.getTime() <= end);
}

export function linesInInclusiveRange(
  lines: Array<PostedReportLine & { postedAt: Date }>,
  from: Date,
  to: Date,
) {
  const start = from.getTime();
  const end = to.getTime();
  return lines.filter((row) => {
    const time = row.postedAt.getTime();
    return time >= start && time <= end;
  });
}

export function journalsInInclusiveRange(
  journals: PostedReportJournal[],
  from: Date,
  to: Date,
) {
  const start = from.getTime();
  const end = to.getTime();
  return journals.filter((journal) => {
    const time = toDate(journal.postedAt).getTime();
    return time >= start && time <= end;
  });
}

export function companyCashBalance(lines: PostedReportLine[]) {
  return roundMoney(
    debitNormalBalance(lines, ACCOUNT_CODE.CASH).plus(debitNormalBalance(lines, ACCOUNT_CODE.BANK)),
  );
}

export function addMoney(left: Decimal.Value, right: Decimal.Value) {
  return moneyStr(roundMoney(left).plus(roundMoney(right)));
}

function bump(target: Record<string, Decimal>, key: keyof CashFlowBuckets, amount: Decimal) {
  target[key] = roundMoney((target[key] ?? roundMoney(0)).plus(amount));
}

function classifyCashCounterpart(accountCode: string, cashIsInflow: boolean): keyof CashFlowBuckets {
  if (cashIsInflow) {
    if (accountCode === ACCOUNT_CODE.INVESTOR_CAPITAL) return 'investorContributionsKgs';
    if (accountCode === ACCOUNT_CODE.SALES_REVENUE) return 'cashSalesKgs';
    if (accountCode === ACCOUNT_CODE.AR) return 'customerCollectionsKgs';
    return 'otherCashInKgs';
  }
  if (accountCode === ACCOUNT_CODE.SUPPLIER_AP || accountCode === ACCOUNT_CODE.INVENTORY) {
    return 'supplierPaymentsKgs';
  }
  if (accountCode === ACCOUNT_CODE.CARGO_AP) return 'cargoPaymentsKgs';
  if (accountCode === ACCOUNT_CODE.TRANSPORT_AP) return 'kyrgyzstanTransportPaymentsKgs';
  if (accountCode === ACCOUNT_CODE.WAREHOUSE_RENT) return 'warehouseRentKgs';
  if (accountCode === ACCOUNT_CODE.STATIONERY) return 'stationeryKgs';
  if (accountCode === ACCOUNT_CODE.OWNER_SALARY) return 'ownerSalaryKgs';
  if (accountCode === ACCOUNT_CODE.OWNER_DRAWINGS) return 'ownerWithdrawalsKgs';
  return 'otherCashOutKgs';
}

function journalCashTotals(journal: PostedReportJournal) {
  const cashDebit = roundMoney(
    journal.lines
      .filter((row) => CASH_CODE_SET.has(row.accountCode))
      .reduce((sum, row) => sum.plus(roundMoney(row.debitKgs)), roundMoney(0)),
  );
  const cashCredit = roundMoney(
    journal.lines
      .filter((row) => CASH_CODE_SET.has(row.accountCode))
      .reduce((sum, row) => sum.plus(roundMoney(row.creditKgs)), roundMoney(0)),
  );
  return { cashDebit, cashCredit };
}

function logisticsCashOutBucket(
  sourceType?: string,
): keyof CashFlowBuckets | null {
  if (isChinaLogisticsCashFlowSource(sourceType)) return 'chinaTransportPaymentsKgs';
  if (isCargoLogisticsCashFlowSource(sourceType)) return 'cargoPaymentsKgs';
  if (isKyrgyzstanLogisticsCashFlowSource(sourceType)) {
    return 'kyrgyzstanTransportPaymentsKgs';
  }
  return null;
}

function classifyBySourceCashMovement(
  journal: PostedReportJournal,
  outflowKey: keyof CashFlowBuckets,
): CashFlowBuckets {
  const { cashDebit, cashCredit } = journalCashTotals(journal);
  const buckets = { ...EMPTY_CASH_FLOW };
  if (cashCredit.gt(0)) {
    buckets[outflowKey] = moneyStr(cashCredit);
  }
  if (cashDebit.gt(0)) {
    buckets.otherCashInKgs = moneyStr(cashDebit);
  }
  return buckets;
}

function toCashFlowBuckets(buckets: Record<string, Decimal>): CashFlowBuckets {
  return {
    investorContributionsKgs: moneyStr(buckets.investorContributionsKgs ?? 0),
    cashSalesKgs: moneyStr(buckets.cashSalesKgs ?? 0),
    customerCollectionsKgs: moneyStr(buckets.customerCollectionsKgs ?? 0),
    otherCashInKgs: moneyStr(buckets.otherCashInKgs ?? 0),
    supplierPaymentsKgs: moneyStr(buckets.supplierPaymentsKgs ?? 0),
    chinaTransportPaymentsKgs: moneyStr(buckets.chinaTransportPaymentsKgs ?? 0),
    cargoPaymentsKgs: moneyStr(buckets.cargoPaymentsKgs ?? 0),
    kyrgyzstanTransportPaymentsKgs: moneyStr(buckets.kyrgyzstanTransportPaymentsKgs ?? 0),
    warehouseRentKgs: moneyStr(buckets.warehouseRentKgs ?? 0),
    stationeryKgs: moneyStr(buckets.stationeryKgs ?? 0),
    ownerSalaryKgs: moneyStr(buckets.ownerSalaryKgs ?? 0),
    ownerWithdrawalsKgs: moneyStr(buckets.ownerWithdrawalsKgs ?? 0),
    otherCashOutKgs: moneyStr(buckets.otherCashOutKgs ?? 0),
  };
}

export function classifyJournalCashFlow(journal: PostedReportJournal): CashFlowBuckets {
  const sourceOutflowKey = logisticsCashOutBucket(journal.sourceType);
  if (sourceOutflowKey) {
    return classifyBySourceCashMovement(journal, sourceOutflowKey);
  }

  const buckets: Record<string, Decimal> = {};
  const { cashDebit, cashCredit } = journalCashTotals(journal);

  const inflowCounterparts = journal.lines
    .filter((row) => !CASH_CODE_SET.has(row.accountCode) && roundMoney(row.creditKgs).gt(0))
    .map((row) => ({ code: row.accountCode, amount: roundMoney(row.creditKgs) }));
  const outflowCounterparts = journal.lines
    .filter((row) => !CASH_CODE_SET.has(row.accountCode) && roundMoney(row.debitKgs).gt(0))
    .map((row) => ({ code: row.accountCode, amount: roundMoney(row.debitKgs) }));

  let remainingIn = cashDebit;
  for (const counterpart of inflowCounterparts) {
    if (!remainingIn.gt(0)) break;
    const allocated = Decimal.min(remainingIn, counterpart.amount);
    bump(buckets, classifyCashCounterpart(counterpart.code, true), allocated);
    remainingIn = roundMoney(remainingIn.minus(allocated));
  }
  if (remainingIn.gt(0)) {
    bump(buckets, 'otherCashInKgs', remainingIn);
  }

  let remainingOut = cashCredit;
  for (const counterpart of outflowCounterparts) {
    if (!remainingOut.gt(0)) break;
    const allocated = Decimal.min(remainingOut, counterpart.amount);
    bump(buckets, classifyCashCounterpart(counterpart.code, false), allocated);
    remainingOut = roundMoney(remainingOut.minus(allocated));
  }
  if (remainingOut.gt(0)) {
    bump(buckets, 'otherCashOutKgs', remainingOut);
  }

  return toCashFlowBuckets(buckets);
}

export function sumCashFlowBuckets(rows: CashFlowBuckets[]): CashFlowBuckets {
  return rows.reduce(
    (sum, row) => ({
      investorContributionsKgs: addMoney(sum.investorContributionsKgs, row.investorContributionsKgs),
      cashSalesKgs: addMoney(sum.cashSalesKgs, row.cashSalesKgs),
      customerCollectionsKgs: addMoney(sum.customerCollectionsKgs, row.customerCollectionsKgs),
      otherCashInKgs: addMoney(sum.otherCashInKgs, row.otherCashInKgs),
      supplierPaymentsKgs: addMoney(sum.supplierPaymentsKgs, row.supplierPaymentsKgs),
      chinaTransportPaymentsKgs: addMoney(
        sum.chinaTransportPaymentsKgs,
        row.chinaTransportPaymentsKgs,
      ),
      cargoPaymentsKgs: addMoney(sum.cargoPaymentsKgs, row.cargoPaymentsKgs),
      kyrgyzstanTransportPaymentsKgs: addMoney(
        sum.kyrgyzstanTransportPaymentsKgs,
        row.kyrgyzstanTransportPaymentsKgs,
      ),
      warehouseRentKgs: addMoney(sum.warehouseRentKgs, row.warehouseRentKgs),
      stationeryKgs: addMoney(sum.stationeryKgs, row.stationeryKgs),
      ownerSalaryKgs: addMoney(sum.ownerSalaryKgs, row.ownerSalaryKgs),
      ownerWithdrawalsKgs: addMoney(sum.ownerWithdrawalsKgs, row.ownerWithdrawalsKgs),
      otherCashOutKgs: addMoney(sum.otherCashOutKgs, row.otherCashOutKgs),
    }),
    { ...EMPTY_CASH_FLOW },
  );
}

export function cashFlowNetMovement(buckets: CashFlowBuckets) {
  const inflow = roundMoney(buckets.investorContributionsKgs)
    .plus(buckets.cashSalesKgs)
    .plus(buckets.customerCollectionsKgs)
    .plus(buckets.otherCashInKgs);
  const outflow = roundMoney(buckets.supplierPaymentsKgs)
    .plus(buckets.chinaTransportPaymentsKgs)
    .plus(buckets.cargoPaymentsKgs)
    .plus(buckets.kyrgyzstanTransportPaymentsKgs)
    .plus(buckets.warehouseRentKgs)
    .plus(buckets.stationeryKgs)
    .plus(buckets.ownerSalaryKgs)
    .plus(buckets.ownerWithdrawalsKgs)
    .plus(buckets.otherCashOutKgs);
  return {
    totalCashInKgs: moneyStr(inflow),
    totalCashOutKgs: moneyStr(outflow),
    netCashKgs: moneyStr(roundMoney(inflow.minus(outflow))),
  };
}

export function periodKey(postedAt: Date | string, groupBy: CashFlowGroupBy): string {
  const date = toDate(postedAt);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  if (groupBy === 'month') return `${year}-${month}`;
  if (groupBy === 'day') return `${year}-${month}-${day}`;
  return 'range';
}

export function buildCashFlowStatement(params: {
  journals: PostedReportJournal[];
  from: Date;
  to: Date;
  groupBy?: CashFlowGroupBy;
}) {
  const groupBy = params.groupBy ?? 'range';
  const allLines = flattenJournalLines(params.journals);
  const openingLines = allLines.filter((row) => row.postedAt.getTime() < params.from.getTime());
  const openingCashKgs = moneyStr(companyCashBalance(openingLines));
  const periodJournals = journalsInInclusiveRange(params.journals, params.from, params.to);

  const grouped = new Map<string, PostedReportJournal[]>();
  for (const journal of periodJournals) {
    const key = periodKey(journal.postedAt, groupBy);
    const list = grouped.get(key) ?? [];
    list.push(journal);
    grouped.set(key, list);
  }

  const periods = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, journals]) => {
      const buckets = sumCashFlowBuckets(journals.map(classifyJournalCashFlow));
      return { key, ...buckets, ...cashFlowNetMovement(buckets) };
    });

  const totals = sumCashFlowBuckets(periodJournals.map(classifyJournalCashFlow));
  const movement = cashFlowNetMovement(totals);
  const closingCashKgs = moneyStr(
    roundMoney(openingCashKgs).plus(roundMoney(movement.netCashKgs)),
  );
  const glClosingCashKgs = moneyStr(
    companyCashBalance(linesOnOrBefore(allLines, params.to)),
  );

  return {
    openingCashKgs,
    ...totals,
    ...movement,
    closingCashKgs,
    glClosingCashKgs,
    differenceKgs: moneyStr(roundMoney(closingCashKgs).minus(roundMoney(glClosingCashKgs))),
    periods,
  };
}

export function buildProfitAndLoss(lines: PostedReportLine[]) {
  const salesRevenueKgs = moneyStr(creditNormalBalance(lines, ACCOUNT_CODE.SALES_REVENUE));
  const cogsKgs = moneyStr(debitNormalBalance(lines, ACCOUNT_CODE.COGS));
  const grossProfitKgs = moneyStr(roundMoney(salesRevenueKgs).minus(roundMoney(cogsKgs)));
  const warehouseRentKgs = moneyStr(debitNormalBalance(lines, ACCOUNT_CODE.WAREHOUSE_RENT));
  const stationeryKgs = moneyStr(debitNormalBalance(lines, ACCOUNT_CODE.STATIONERY));
  const ownerSalaryKgs = moneyStr(debitNormalBalance(lines, ACCOUNT_CODE.OWNER_SALARY));
  const otherOperatingExpensesKgs = moneyStr(debitNormalBalance(lines, ACCOUNT_CODE.OTHER_OPEX));
  const operatingExpensesKgs = moneyStr(
    roundMoney(warehouseRentKgs)
      .plus(stationeryKgs)
      .plus(ownerSalaryKgs)
      .plus(otherOperatingExpensesKgs),
  );
  const netProfitKgs = moneyStr(roundMoney(grossProfitKgs).minus(roundMoney(operatingExpensesKgs)));

  return {
    salesRevenueKgs,
    cogsKgs,
    grossProfitKgs,
    warehouseRentKgs,
    stationeryKgs,
    ownerSalaryKgs,
    otherOperatingExpensesKgs,
    operatingExpensesKgs,
    netProfitKgs,
  };
}

export function buildBalanceSheet(lines: PostedReportLine[]) {
  const cashKgs = moneyStr(debitNormalBalance(lines, ACCOUNT_CODE.CASH));
  const bankKgs = moneyStr(debitNormalBalance(lines, ACCOUNT_CODE.BANK));
  const accountsReceivableKgs = moneyStr(debitNormalBalance(lines, ACCOUNT_CODE.AR));
  const inventoryKgs = moneyStr(debitNormalBalance(lines, ACCOUNT_CODE.INVENTORY));
  const totalAssetsKgs = moneyStr(
    roundMoney(cashKgs).plus(bankKgs).plus(accountsReceivableKgs).plus(inventoryKgs),
  );

  const supplierApKgs = moneyStr(creditNormalBalance(lines, ACCOUNT_CODE.SUPPLIER_AP));
  const cargoApKgs = moneyStr(creditNormalBalance(lines, ACCOUNT_CODE.CARGO_AP));
  const transportApKgs = moneyStr(creditNormalBalance(lines, ACCOUNT_CODE.TRANSPORT_AP));
  const otherPayablesKgs = '0.00';
  const totalLiabilitiesKgs = moneyStr(
    roundMoney(supplierApKgs).plus(cargoApKgs).plus(transportApKgs).plus(otherPayablesKgs),
  );

  const investorCapitalKgs = moneyStr(creditNormalBalance(lines, ACCOUNT_CODE.INVESTOR_CAPITAL));
  const ownerDrawingsKgs = moneyStr(debitNormalBalance(lines, ACCOUNT_CODE.OWNER_DRAWINGS));
  const closedRetainedEarningsKgs = moneyStr(
    creditNormalBalance(lines, ACCOUNT_CODE.RETAINED_EARNINGS),
  );
  const currentPeriod = buildProfitAndLoss(lines);
  const retainedEarningsKgs = moneyStr(
    roundMoney(closedRetainedEarningsKgs).plus(currentPeriod.netProfitKgs),
  );
  const totalEquityKgs = moneyStr(
    roundMoney(investorCapitalKgs).plus(retainedEarningsKgs).minus(roundMoney(ownerDrawingsKgs)),
  );
  const liabilitiesPlusEquityKgs = moneyStr(
    roundMoney(totalLiabilitiesKgs).plus(roundMoney(totalEquityKgs)),
  );
  const differenceKgs = moneyStr(
    roundMoney(totalAssetsKgs).minus(roundMoney(liabilitiesPlusEquityKgs)),
  );

  return {
    assets: {
      cashKgs,
      bankKgs,
      accountsReceivableKgs,
      inventoryKgs,
      totalAssetsKgs,
    },
    liabilities: {
      supplierApKgs,
      cargoApKgs,
      transportApKgs,
      otherPayablesKgs,
      totalLiabilitiesKgs,
    },
    equity: {
      investorCapitalKgs,
      retainedEarningsKgs,
      ownerDrawingsKgs,
      totalEquityKgs,
    },
    liabilitiesPlusEquityKgs,
    differenceKgs,
  };
}

export function postedReportJournals(journals: PostedReportJournal[]) {
  return journals.filter((row) => row.status !== 'VOIDED');
}

export function buildFinanceDashboard(params: {
  journals: PostedReportJournal[];
  from: Date;
  to: Date;
}) {
  const allLines = flattenJournalLines(postedReportJournals(params.journals));
  const asOfLines = linesOnOrBefore(allLines, params.to);
  const periodLines = linesInInclusiveRange(allLines, params.from, params.to);
  const balanceSheet = buildBalanceSheet(asOfLines);
  const profitAndLoss = buildProfitAndLoss(periodLines);
  return {
    companyCashKgs: balanceSheet.assets.cashKgs,
    companyBankKgs: balanceSheet.assets.bankKgs,
    investorCapitalKgs: balanceSheet.equity.investorCapitalKgs,
    inventoryValueKgs: balanceSheet.assets.inventoryKgs,
    accountsReceivableKgs: balanceSheet.assets.accountsReceivableKgs,
    supplierDebtKgs: balanceSheet.liabilities.supplierApKgs,
    cargoDebtKgs: balanceSheet.liabilities.cargoApKgs,
    transportDebtKgs: balanceSheet.liabilities.transportApKgs,
    salesRevenueKgs: profitAndLoss.salesRevenueKgs,
    cogsKgs: profitAndLoss.cogsKgs,
    grossProfitKgs: profitAndLoss.grossProfitKgs,
    operatingExpensesKgs: profitAndLoss.operatingExpensesKgs,
    netProfitKgs: profitAndLoss.netProfitKgs,
    balanceDifferenceKgs: balanceSheet.differenceKgs,
  };
}
