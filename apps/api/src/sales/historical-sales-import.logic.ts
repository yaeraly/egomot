import Decimal from 'decimal.js';
import * as path from 'path';

export const FINAL_EXPECTED_SOURCE_ROWS = 1533;
export const FINAL_EXPECTED_SALE_ITEMS = 1533;
export const FINAL_EXPECTED_TOTAL_QUANTITY = '6555';
export const FINAL_EXPECTED_TOTAL_AMOUNT_KGS = '8160605';

export const WALK_IN_CUSTOMER_NAME = 'Walk-in Customer';
export const WALK_IN_CUSTOMER_PHONE = 'walk-in';
export const WALK_IN_GROUP_TOKEN = 'walk-in';
export const ROZNICNY_LABEL = 'розничный';

const SKIP_PRODUCTS = new Set(['Товар']);

export const PRODUCT_ALIASES: Record<string, string> = {
  'Аккумулятор 58Ач': 'Chaowei Аккумулятор 58 Ач',
};

export type BatchStatus = 'PASS' | 'WARNING' | 'ERROR';

export interface RawSalesRow {
  lineNumber: number;
  dateStr: string;
  phone: string;
  productName: string;
  quantityStr: string;
  unitPriceStr: string;
}

export interface ParsedSalesRow {
  lineNumber: number;
  sourceRowId: string;
  saleDate: Date;
  phone: string;
  phoneDigits: string;
  isWalkIn: boolean;
  productName: string;
  quantity: Decimal;
  unitPriceKgs: Decimal;
  lineTotalKgs: Decimal;
}

export interface SalesValidationIssue {
  lineNumber: number;
  message: string;
}

export interface SalesGroup {
  key: string;
  saleDate: Date;
  phone: string;
  phoneDigits: string;
  isWalkIn: boolean;
  items: ParsedSalesRow[];
}

export interface SalesBatchTotals {
  sourceRows: number;
  validRows: number;
  invalidRows: number;
  saleItems: number;
  saleGroups: number;
  walkInRows: number;
  totalQuantity: string;
  totalAmountKgs: string;
}

export interface SalesBatchValidationResult {
  status: BatchStatus;
  rawRows: RawSalesRow[];
  parsed: ParsedSalesRow[];
  issues: SalesValidationIssue[];
  groups: SalesGroup[];
  totals: SalesBatchTotals;
}

export interface SalesFinalValidationResult {
  status: 'PASS' | 'BLOCKED';
  totals: SalesBatchTotals;
  discrepancies: string[];
}

export function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function normalizeCustomerLabel(value: string): string {
  return normalizeHistoricalField(value).replace(/\s+/g, ' ').trim().toLowerCase();
}

export function isRoznichnyCustomer(value: string): boolean {
  return normalizeCustomerLabel(value) === ROZNICNY_LABEL;
}

export type HistoricalCustomerIdentity =
  | { kind: 'walk-in'; groupToken: typeof WALK_IN_GROUP_TOKEN; lookedUpPhone: false }
  | { kind: 'phone'; phoneDigits: string; lookedUpPhone: true }
  | { kind: 'invalid'; message: string; lookedUpPhone: boolean };

export function resolveHistoricalCustomer(
  customerField: string,
): HistoricalCustomerIdentity {
  if (!customerField.trim()) {
    return { kind: 'invalid', message: 'Missing client', lookedUpPhone: false };
  }

  if (isRoznichnyCustomer(customerField)) {
    return {
      kind: 'walk-in',
      groupToken: WALK_IN_GROUP_TOKEN,
      lookedUpPhone: false,
    };
  }

  const phoneDigits = normalizePhoneDigits(customerField);
  if (phoneDigits.length >= 9) {
    return { kind: 'phone', phoneDigits, lookedUpPhone: true };
  }

  return {
    kind: 'invalid',
    message: `Invalid phone "${customerField}"`,
    lookedUpPhone: true,
  };
}

export function normalizeHistoricalField(value: string): string {
  let trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    trimmed = trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

export function parseDelimitedRow(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === '\t' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  fields.push(current);
  return fields;
}

function dec(value: string | number): Decimal {
  return new Decimal(value);
}

function roundQty(value: Decimal): Decimal {
  return value.toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
}

function roundMoney(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function parseSaleDate(dateStr: string): Date | null {
  const normalized = normalizeHistoricalField(dateStr);
  const parts = normalized.split('/');
  if (parts.length !== 3) return null;
  const month = Number(parts[0]);
  const day = Number(parts[1]);
  const year = Number(parts[2]);
  if (!month || !day || !year) return null;
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function parseMoney(value: string): Decimal | null {
  const trimmed = normalizeHistoricalField(value).replace(/,/g, '');
  if (!trimmed) return null;
  const n = dec(trimmed);
  return n.isNaN() ? null : n;
}

function parseQuantity(value: string): Decimal | null {
  const trimmed = normalizeHistoricalField(value).replace(/,/g, '');
  if (!trimmed) return null;
  const n = dec(trimmed);
  return n.isNaN() ? null : n;
}

export function parseHistoricalSalesTsv(content: string): RawSalesRow[] {
  const lines = content.split(/\r?\n/);
  const rows: RawSalesRow[] = [];
  let lineNumber = 0;

  for (const line of lines) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (
      trimmed.startsWith('ДАТА') ||
      trimmed.includes('КОЛИЧ') ||
      trimmed.includes('ЦЕНА') ||
      /^КЛИЕНТ\b/i.test(trimmed)
    ) {
      continue;
    }

    const parts = parseDelimitedRow(line);
    if (parts.length < 5) continue;

    rows.push({
      lineNumber,
      dateStr: normalizeHistoricalField(parts[0]),
      phone: normalizeHistoricalField(parts[1]),
      productName: normalizeHistoricalField(parts[2]),
      quantityStr: normalizeHistoricalField(parts[3]),
      unitPriceStr: normalizeHistoricalField(parts[4]),
    });
  }

  return rows;
}

export function resolveProductName(name: string): string {
  return PRODUCT_ALIASES[name] ?? name;
}

export function buildSourceRowId(
  sourceFile: string,
  row: {
    lineNumber: number;
    saleDate: Date;
    phoneDigits: string;
    productName: string;
    quantity: Decimal;
    unitPriceKgs: Decimal;
  },
): string {
  const base = path.basename(sourceFile);
  const dateKey = row.saleDate.toISOString().slice(0, 10);
  const product = resolveProductName(row.productName);
  return [
    'historical-row',
    base,
    `L${row.lineNumber}`,
    dateKey,
    row.phoneDigits,
    product,
    row.quantity.toFixed(3),
    row.unitPriceKgs.toFixed(2),
  ].join('|');
}

export function buildSaleGroupKey(row: Pick<ParsedSalesRow, 'saleDate' | 'phoneDigits'>): string {
  const dateKey = row.saleDate.toISOString().slice(0, 10);
  return `${dateKey}|${row.phoneDigits}`;
}

function parseBatchRows(
  content: string,
  sourceFile: string,
): Pick<SalesBatchValidationResult, 'rawRows' | 'parsed' | 'issues'> {
  const rawRows = parseHistoricalSalesTsv(content);
  const parsed: ParsedSalesRow[] = [];
  const issues: SalesValidationIssue[] = [];

  for (const row of rawRows) {
    if (!row.dateStr) {
      issues.push({ lineNumber: row.lineNumber, message: 'Missing date' });
      continue;
    }
    if (!row.phone) {
      issues.push({ lineNumber: row.lineNumber, message: 'Missing client' });
      continue;
    }
    if (!row.productName) {
      issues.push({ lineNumber: row.lineNumber, message: 'Missing product name' });
      continue;
    }
    if (SKIP_PRODUCTS.has(row.productName)) {
      issues.push({
        lineNumber: row.lineNumber,
        message: `Skipped placeholder product "${row.productName}"`,
      });
      continue;
    }

    const saleDate = parseSaleDate(row.dateStr);
    if (!saleDate) {
      issues.push({
        lineNumber: row.lineNumber,
        message: `Invalid date "${row.dateStr}"`,
      });
      continue;
    }

    const quantity = parseQuantity(row.quantityStr);
    if (quantity === null || quantity.lte(0)) {
      issues.push({
        lineNumber: row.lineNumber,
        message: `Invalid or missing quantity "${row.quantityStr}"`,
      });
      continue;
    }

    const unitPriceKgs = parseMoney(row.unitPriceStr);
    if (unitPriceKgs === null || unitPriceKgs.lte(0)) {
      issues.push({
        lineNumber: row.lineNumber,
        message: `Invalid or missing unit price "${row.unitPriceStr}"`,
      });
      continue;
    }

    const customer = resolveHistoricalCustomer(row.phone);
    if (customer.kind === 'invalid') {
      issues.push({
        lineNumber: row.lineNumber,
        message: customer.message,
      });
      continue;
    }

    const isWalkIn = customer.kind === 'walk-in';
    const phoneDigits =
      customer.kind === 'walk-in' ? customer.groupToken : customer.phoneDigits;

    const qty = roundQty(quantity);
    const unitPrice = roundMoney(unitPriceKgs);
    const baseRow = {
      lineNumber: row.lineNumber,
      saleDate,
      phone: row.phone,
      phoneDigits,
      isWalkIn,
      productName: row.productName,
      quantity: qty,
      unitPriceKgs: unitPrice,
      lineTotalKgs: roundMoney(qty.times(unitPrice)),
    };

    parsed.push({
      ...baseRow,
      sourceRowId: buildSourceRowId(sourceFile, baseRow),
    });
  }

  return { rawRows, parsed, issues };
}

function summarizeBatch(
  rawRows: RawSalesRow[],
  parsed: ParsedSalesRow[],
  issues: SalesValidationIssue[],
): SalesBatchTotals {
  const groups = groupHistoricalSales(parsed);
  const totalQuantity = parsed.reduce(
    (sum, row) => sum.plus(row.quantity),
    new Decimal(0),
  );
  const totalAmountKgs = parsed.reduce(
    (sum, row) => sum.plus(row.lineTotalKgs),
    new Decimal(0),
  );

  return {
    sourceRows: rawRows.length,
    validRows: parsed.length,
    invalidRows: issues.length,
    saleItems: parsed.length,
    saleGroups: groups.length,
    walkInRows: parsed.filter((row) => row.isWalkIn).length,
    totalQuantity: totalQuantity.toFixed(),
    totalAmountKgs: totalAmountKgs.toFixed(2),
  };
}

export function resolveBatchStatus(
  validRows: number,
  invalidRows: number,
): BatchStatus {
  if (validRows === 0) return 'ERROR';
  if (invalidRows > 0) return 'WARNING';
  return 'PASS';
}

export function validateHistoricalSalesBatch(
  content: string,
  sourceFile = 'historical-sales.tsv',
): SalesBatchValidationResult {
  const { rawRows, parsed, issues } = parseBatchRows(content, sourceFile);
  const totals = summarizeBatch(rawRows, parsed, issues);
  const groups = groupHistoricalSales(parsed);

  return {
    status: resolveBatchStatus(totals.validRows, totals.invalidRows),
    rawRows,
    parsed,
    issues,
    groups,
    totals,
  };
}

export function validateFinalHistoricalSales(
  content: string,
  sourceFile = 'historical-sales.tsv',
): SalesFinalValidationResult {
  const batch = validateHistoricalSalesBatch(content, sourceFile);
  const discrepancies: string[] = [];

  if (batch.totals.sourceRows !== FINAL_EXPECTED_SOURCE_ROWS) {
    discrepancies.push(
      `Expected rows: ${FINAL_EXPECTED_SOURCE_ROWS}, got ${batch.totals.sourceRows}`,
    );
  }
  if (batch.totals.saleItems !== FINAL_EXPECTED_SALE_ITEMS) {
    discrepancies.push(
      `Expected sale items: ${FINAL_EXPECTED_SALE_ITEMS}, got ${batch.totals.saleItems}`,
    );
  }
  if (batch.totals.totalQuantity !== FINAL_EXPECTED_TOTAL_QUANTITY) {
    discrepancies.push(
      `Expected quantity: ${FINAL_EXPECTED_TOTAL_QUANTITY}, got ${batch.totals.totalQuantity}`,
    );
  }
  if (batch.totals.totalAmountKgs !== FINAL_EXPECTED_TOTAL_AMOUNT_KGS) {
    discrepancies.push(
      `Expected sales: ${FINAL_EXPECTED_TOTAL_AMOUNT_KGS}, got ${batch.totals.totalAmountKgs}`,
    );
  }

  return {
    status: discrepancies.length === 0 ? 'PASS' : 'BLOCKED',
    totals: batch.totals,
    discrepancies,
  };
}

export function groupHistoricalSales(rows: ParsedSalesRow[]): SalesGroup[] {
  const map = new Map<string, SalesGroup>();

  for (const row of rows) {
    const key = buildSaleGroupKey(row);
    const existing = map.get(key);
    if (existing) {
      existing.items.push(row);
    } else {
      map.set(key, {
        key,
        saleDate: row.saleDate,
        phone: row.phone,
        phoneDigits: row.phoneDigits,
        isWalkIn: row.isWalkIn,
        items: [row],
      });
    }
  }

  return [...map.values()].sort(
    (a, b) => a.saleDate.getTime() - b.saleDate.getTime(),
  );
}

export function filterNewRows(
  rows: ParsedSalesRow[],
  importedSourceRowIds: Set<string>,
): { newRows: ParsedSalesRow[]; duplicatesSkipped: number } {
  const newRows: ParsedSalesRow[] = [];
  let duplicatesSkipped = 0;

  for (const row of rows) {
    if (importedSourceRowIds.has(row.sourceRowId)) {
      duplicatesSkipped += 1;
    } else {
      newRows.push(row);
    }
  }

  return { newRows, duplicatesSkipped };
}

export function printBatchValidationReport(
  result: SalesBatchValidationResult,
  sourceFile?: string,
): void {
  console.log('=== HISTORICAL SALES VALIDATION ===');
  console.log('');
  if (sourceFile) {
    console.log(`Source file:       ${sourceFile}`);
  }
  console.log(`Source rows:        ${result.totals.sourceRows}`);
  console.log(`Valid sale items:   ${result.totals.validRows}`);
  console.log(`Sale groups:        ${result.totals.saleGroups}`);
  console.log(`Total quantity:     ${result.totals.totalQuantity}`);
  console.log(`Sales amount:       ${result.totals.totalAmountKgs} сом`);
  console.log(`Validation issues:  ${result.issues.length}`);
  console.log(`Walk-in rows:       ${result.totals.walkInRows}`);

  if (result.issues.length) {
    console.log('');
    console.log('Skipped invalid rows:');
    for (const issue of result.issues) {
      console.log(`Row ${issue.lineNumber} — ${issue.message}`);
    }
  }

  console.log('');
  console.log(`Status: ${result.status}`);
}

export function resolveValidateExitCode(status: BatchStatus): number {
  return status === 'ERROR' ? 1 : 0;
}

export function printFinalReconciliationReport(
  result: SalesFinalValidationResult,
): void {
  console.log('=== FINAL HISTORICAL SALES RECONCILIATION ===');
  console.log(`Expected rows:        ${FINAL_EXPECTED_SOURCE_ROWS}`);
  console.log(`Actual rows:          ${result.totals.sourceRows}`);
  console.log('');
  console.log(`Expected quantity:    ${FINAL_EXPECTED_TOTAL_QUANTITY}`);
  console.log(`Actual quantity:      ${result.totals.totalQuantity}`);
  console.log('');
  console.log(`Expected sales:       ${FINAL_EXPECTED_TOTAL_AMOUNT_KGS} сом`);
  console.log(`Actual sales:         ${result.totals.totalAmountKgs} сом`);

  if (result.discrepancies.length) {
    console.log('\nDiscrepancies:');
    for (const line of result.discrepancies) {
      console.log(`  ${line}`);
    }
  }

  console.log(`\nStatus: ${result.status}`);
}

/** @deprecated Use validateHistoricalSalesBatch */
export function validateHistoricalSales(content: string): SalesBatchValidationResult {
  return validateHistoricalSalesBatch(content);
}

/** @deprecated Use printBatchValidationReport */
export function printSalesValidationReport(result: SalesBatchValidationResult): void {
  printBatchValidationReport(result);
}
