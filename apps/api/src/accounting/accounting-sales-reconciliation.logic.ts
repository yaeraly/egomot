import { moneyStr, roundMoney, Decimal } from '../purchases/purchase-calc';
import {
  FINAL_EXPECTED_SALE_ITEMS,
  FINAL_EXPECTED_SOURCE_ROWS,
  FINAL_EXPECTED_TOTAL_AMOUNT_KGS,
  FINAL_EXPECTED_TOTAL_QUANTITY,
  WALK_IN_CUSTOMER_NAME,
  WALK_IN_CUSTOMER_PHONE,
  WALK_IN_GROUP_TOKEN,
  groupHistoricalSales,
  normalizePhoneDigits,
  resolveHistoricalCustomer,
  resolveProductName,
  validateFinalHistoricalSales,
  validateHistoricalSalesBatch,
  type ParsedSalesRow,
} from '../sales/historical-sales-import.logic';

export const SALES_RECONCILIATION_BLOCKER = 'BLOCKED — SALES RECONCILIATION REQUIRED';

export const LIVE_DB_SALES_REVENUE_KGS = '9167215.00';
export const LIVE_DB_SALES_CONTROL_DIFFERENCE_KGS = '1006610.00';

export type SalesMismatchReason =
  | 'exact match'
  | 'duplicate SaleItem'
  | 'incorrect selling price'
  | 'wrong quantity'
  | 'additional legitimate sales not present in TSV'
  | 'missing import source marker'
  | 'TSV row missing from database'
  | 'committed TSV does not match 1533-row control totals';

export type SalesMismatchRow = {
  date: string;
  customer: string;
  product: string;
  quantity: string;
  unitPriceKgs: string;
  lineTotalKgs: string;
  reason: SalesMismatchReason;
  source: 'DB' | 'TSV';
  saleNumber?: string;
};

export type DbSaleLineInput = {
  saleId: string;
  saleNumber: string;
  saleDate: Date;
  customerName: string;
  customerPhone: string;
  productName: string;
  quantity: string;
  unitPriceKgs: string;
  lineTotalKgs: string;
  idempotencyKey?: string | null;
};

export type SalesReconciliationResult = {
  tsvRows: number;
  tsvValidRows: number;
  tsvQuantity: string;
  tsvRevenueKgs: string;
  tsvSaleGroups: number;
  tsvWalkInRows: number;
  tsvFileMatchesControlTotals: boolean;
  tsvFileDiscrepancies: string[];
  dbSales: number;
  dbSaleItems: number;
  dbQuantity: string;
  dbRevenueKgs: string;
  dbCashRevenueKgs: string;
  dbCreditRevenueKgs: string;
  dbCogsKgs: string;
  controlRowCount: number;
  controlQuantity: string;
  controlRevenueKgs: string;
  controlDifferenceKgs: string;
  historicalImportedSaleCount: number;
  nonHistoricalSaleCount: number;
  historicalImportedRevenueKgs: string;
  nonHistoricalRevenueKgs: string;
  extraDbRevenueVsTsvFileKgs: string;
  mismatchRows: SalesMismatchRow[];
  matchesControlTotals: boolean;
};

export function parseHistoricalIdempotencyKey(
  key: string | null | undefined,
): { date: string; phoneDigits: string } | null {
  if (!key || !key.startsWith('historical-')) return null;
  const rest = key.slice('historical-'.length);
  const idx = rest.indexOf('|');
  if (idx <= 0) return null;
  return { date: rest.slice(0, idx), phoneDigits: rest.slice(idx + 1) };
}

export function isHistoricalImportedSale(idempotencyKey: string | null | undefined): boolean {
  return Boolean(parseHistoricalIdempotencyKey(idempotencyKey));
}

function dateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function qtyKey(value: Decimal.Value): string {
  return new Decimal(value).toDecimalPlaces(3, Decimal.ROUND_HALF_UP).toFixed(3);
}

function priceKey(value: Decimal.Value): string {
  return moneyStr(value);
}

function customerDigitsFromDbLine(line: DbSaleLineInput): string {
  const parsed = parseHistoricalIdempotencyKey(line.idempotencyKey);
  if (parsed) return parsed.phoneDigits;
  if (
    line.customerName === WALK_IN_CUSTOMER_NAME ||
    line.customerPhone === WALK_IN_CUSTOMER_PHONE ||
    resolveHistoricalCustomer(line.customerPhone).kind === 'walk-in'
  ) {
    return WALK_IN_GROUP_TOKEN;
  }
  const digits = normalizePhoneDigits(line.customerPhone);
  return digits || WALK_IN_GROUP_TOKEN;
}

function exactKey(params: {
  date: string;
  phoneDigits: string;
  productName: string;
  quantity: Decimal.Value;
  unitPriceKgs: Decimal.Value;
}): string {
  return [
    params.date,
    params.phoneDigits,
    resolveProductName(params.productName),
    qtyKey(params.quantity),
    priceKey(params.unitPriceKgs),
  ].join('|');
}

function takeMatching(
  remaining: ParsedSalesRow[],
  predicate: (row: ParsedSalesRow) => boolean,
): ParsedSalesRow | null {
  const idx = remaining.findIndex(predicate);
  if (idx < 0) return null;
  return remaining.splice(idx, 1)[0];
}

export function computeSalesControlDifference(dbRevenueKgs: Decimal.Value): string {
  return moneyStr(roundMoney(dbRevenueKgs).minus(roundMoney(FINAL_EXPECTED_TOTAL_AMOUNT_KGS)));
}

export function reconcileHistoricalSales(params: {
  tsvContent: string;
  tsvFileName?: string;
  dbLines: DbSaleLineInput[];
  dbSaleCount: number;
  dbRevenueKgs: string;
  dbCashRevenueKgs?: string;
  dbCreditRevenueKgs?: string;
  dbCogsKgs?: string;
}): SalesReconciliationResult {
  const tsvFileName = params.tsvFileName ?? 'historical-sales.tsv';
  const batch = validateHistoricalSalesBatch(params.tsvContent, tsvFileName);
  const finalValidation = validateFinalHistoricalSales(params.tsvContent, tsvFileName);
  const groups = groupHistoricalSales(batch.parsed);
  const remaining = [...batch.parsed];

  const mismatchRows: SalesMismatchRow[] = [];
  let extraDbVsTsv = roundMoney(0);

  const saleIds = new Set(params.dbLines.map((row) => row.saleId));
  const historicalSaleIds = new Set(
    params.dbLines
      .filter((row) => isHistoricalImportedSale(row.idempotencyKey))
      .map((row) => row.saleId),
  );
  const historicalRevenueBySale = new Map<string, Decimal>();
  const liveRevenueBySale = new Map<string, Decimal>();

  for (const line of params.dbLines) {
    const amount = roundMoney(line.lineTotalKgs);
    if (isHistoricalImportedSale(line.idempotencyKey)) {
      historicalRevenueBySale.set(
        line.saleId,
        (historicalRevenueBySale.get(line.saleId) ?? roundMoney(0)).plus(amount),
      );
    } else {
      liveRevenueBySale.set(
        line.saleId,
        (liveRevenueBySale.get(line.saleId) ?? roundMoney(0)).plus(amount),
      );
    }

    const date = dateKey(line.saleDate);
    const phoneDigits = customerDigitsFromDbLine(line);
    const productName = resolveProductName(line.productName);

    const exact = takeMatching(
      remaining,
      (row) =>
        exactKey({
          date: dateKey(row.saleDate),
          phoneDigits: row.phoneDigits,
          productName: row.productName,
          quantity: row.quantity,
          unitPriceKgs: row.unitPriceKgs,
        }) ===
        exactKey({
          date,
          phoneDigits,
          productName,
          quantity: line.quantity,
          unitPriceKgs: line.unitPriceKgs,
        }),
    );
    if (exact) continue;

    const priceMismatch = takeMatching(
      remaining,
      (row) =>
        dateKey(row.saleDate) === date &&
        row.phoneDigits === phoneDigits &&
        resolveProductName(row.productName) === productName &&
        qtyKey(row.quantity) === qtyKey(line.quantity),
    );
    if (priceMismatch) {
      mismatchRows.push({
        date,
        customer: line.customerName,
        product: line.productName,
        quantity: qtyKey(line.quantity),
        unitPriceKgs: priceKey(line.unitPriceKgs),
        lineTotalKgs: moneyStr(amount),
        reason: 'incorrect selling price',
        source: 'DB',
        saleNumber: line.saleNumber,
      });
      extraDbVsTsv = extraDbVsTsv.plus(amount);
      continue;
    }

    const qtyMismatch = takeMatching(
      remaining,
      (row) =>
        dateKey(row.saleDate) === date &&
        row.phoneDigits === phoneDigits &&
        resolveProductName(row.productName) === productName,
    );
    if (qtyMismatch) {
      mismatchRows.push({
        date,
        customer: line.customerName,
        product: line.productName,
        quantity: qtyKey(line.quantity),
        unitPriceKgs: priceKey(line.unitPriceKgs),
        lineTotalKgs: moneyStr(amount),
        reason: 'wrong quantity',
        source: 'DB',
        saleNumber: line.saleNumber,
      });
      extraDbVsTsv = extraDbVsTsv.plus(amount);
      continue;
    }

    const imported = isHistoricalImportedSale(line.idempotencyKey);
    const reason: SalesMismatchReason = imported
      ? finalValidation.discrepancies.length > 0
        ? 'additional legitimate sales not present in TSV'
        : 'duplicate SaleItem'
      : 'missing import source marker';
    mismatchRows.push({
      date,
      customer: line.customerName,
      product: line.productName,
      quantity: qtyKey(line.quantity),
      unitPriceKgs: priceKey(line.unitPriceKgs),
      lineTotalKgs: moneyStr(amount),
      reason,
      source: 'DB',
      saleNumber: line.saleNumber,
    });
    extraDbVsTsv = extraDbVsTsv.plus(amount);
  }

  for (const row of remaining) {
    mismatchRows.push({
      date: dateKey(row.saleDate),
      customer: row.isWalkIn ? WALK_IN_CUSTOMER_NAME : row.phone,
      product: row.productName,
      quantity: qtyKey(row.quantity),
      unitPriceKgs: priceKey(row.unitPriceKgs),
      lineTotalKgs: moneyStr(row.lineTotalKgs),
      reason: 'TSV row missing from database',
      source: 'TSV',
    });
  }

  if (finalValidation.discrepancies.length > 0) {
    mismatchRows.unshift({
      date: '',
      customer: '',
      product: '',
      quantity: batch.totals.totalQuantity,
      unitPriceKgs: '',
      lineTotalKgs: batch.totals.totalAmountKgs,
      reason: 'committed TSV does not match 1533-row control totals',
      source: 'TSV',
    });
  }

  const dbQuantity = params.dbLines.reduce(
    (sum, row) => sum.plus(new Decimal(row.quantity)),
    new Decimal(0),
  );
  const dbRevenue = roundMoney(params.dbRevenueKgs);
  const controlRevenue = roundMoney(FINAL_EXPECTED_TOTAL_AMOUNT_KGS);
  const controlDifference = roundMoney(dbRevenue.minus(controlRevenue));
  const historicalImportedRevenue = [...historicalRevenueBySale.values()].reduce(
    (sum, row) => sum.plus(row),
    roundMoney(0),
  );
  const nonHistoricalRevenue = [...liveRevenueBySale.values()].reduce(
    (sum, row) => sum.plus(row),
    roundMoney(0),
  );

  const matchesControlTotals =
    params.dbLines.length === FINAL_EXPECTED_SALE_ITEMS &&
    dbQuantity.eq(new Decimal(FINAL_EXPECTED_TOTAL_QUANTITY)) &&
    dbRevenue.eq(controlRevenue);

  return {
    tsvRows: batch.totals.sourceRows,
    tsvValidRows: batch.totals.validRows,
    tsvQuantity: batch.totals.totalQuantity,
    tsvRevenueKgs: batch.totals.totalAmountKgs,
    tsvSaleGroups: groups.length,
    tsvWalkInRows: batch.totals.walkInRows,
    tsvFileMatchesControlTotals: finalValidation.status === 'PASS',
    tsvFileDiscrepancies: finalValidation.discrepancies,
    dbSales: params.dbSaleCount,
    dbSaleItems: params.dbLines.length,
    dbQuantity: dbQuantity.toFixed(3),
    dbRevenueKgs: moneyStr(dbRevenue),
    dbCashRevenueKgs: moneyStr(params.dbCashRevenueKgs ?? dbRevenue),
    dbCreditRevenueKgs: moneyStr(params.dbCreditRevenueKgs ?? 0),
    dbCogsKgs: moneyStr(params.dbCogsKgs ?? 0),
    controlRowCount: FINAL_EXPECTED_SOURCE_ROWS,
    controlQuantity: FINAL_EXPECTED_TOTAL_QUANTITY,
    controlRevenueKgs: moneyStr(controlRevenue),
    controlDifferenceKgs: moneyStr(controlDifference),
    historicalImportedSaleCount: historicalSaleIds.size,
    nonHistoricalSaleCount: [...saleIds].filter((id) => !historicalSaleIds.has(id)).length,
    historicalImportedRevenueKgs: moneyStr(historicalImportedRevenue),
    nonHistoricalRevenueKgs: moneyStr(nonHistoricalRevenue),
    extraDbRevenueVsTsvFileKgs: moneyStr(extraDbVsTsv),
    mismatchRows,
    matchesControlTotals,
  };
}

export function formatSalesReconciliationReport(result: SalesReconciliationResult): string {
  const lines = [
    '=== SALES RECONCILIATION ===',
    '',
    'TSV rows:',
    String(result.tsvRows),
    '',
    'TSV quantity:',
    result.tsvQuantity,
    '',
    'TSV revenue:',
    result.tsvRevenueKgs,
    '',
    'Control TSV rows:',
    String(result.controlRowCount),
    '',
    'Control TSV quantity:',
    result.controlQuantity,
    '',
    'Control TSV revenue:',
    result.controlRevenueKgs,
    '',
    'DB sales:',
    String(result.dbSales),
    '',
    'DB sale items:',
    String(result.dbSaleItems),
    '',
    'DB quantity:',
    result.dbQuantity,
    '',
    'DB revenue:',
    result.dbRevenueKgs,
    '',
    'Difference vs control:',
    result.controlDifferenceKgs,
    '',
    'Committed TSV matches 1533-row control totals:',
    result.tsvFileMatchesControlTotals ? 'YES' : 'NO',
    '',
    'Historical imported sales (idempotency historical-*):',
    String(result.historicalImportedSaleCount),
    '',
    'Non-historical / live sales:',
    String(result.nonHistoricalSaleCount),
    '',
    'Non-historical revenue:',
    result.nonHistoricalRevenueKgs,
    '',
    'Sales were not modified.',
  ];
  if (result.tsvFileDiscrepancies.length > 0) {
    lines.push('', 'Committed TSV discrepancies vs control:');
    for (const row of result.tsvFileDiscrepancies) {
      lines.push(`- ${row}`);
    }
  }
  if (result.mismatchRows.length > 0) {
    lines.push('', 'Mismatch rows:');
    for (const row of result.mismatchRows) {
      lines.push(
        [
          row.date,
          row.customer,
          row.product,
          row.quantity,
          row.unitPriceKgs,
          row.lineTotalKgs,
          row.reason,
          row.source,
          row.saleNumber ?? '',
        ].join(' | '),
      );
    }
  }
  return lines.join('\n');
}
