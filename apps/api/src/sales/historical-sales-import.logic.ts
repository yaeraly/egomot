import Decimal from 'decimal.js';

export const EXPECTED_SOURCE_ROWS = 1533;
export const EXPECTED_SALE_ITEMS = 1533;
export const EXPECTED_TOTAL_QUANTITY = '6555';
export const EXPECTED_TOTAL_AMOUNT_KGS = '8160605';

export const WALK_IN_CUSTOMER_NAME = 'Walk-in Customer';
export const WALK_IN_CUSTOMER_PHONE = 'walk-in';

const SKIP_PRODUCTS = new Set(['Товар']);

export const PRODUCT_ALIASES: Record<string, string> = {
  'Аккумулятор 58Ач': 'Chaowei Аккумулятор 58 Ач',
};

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
  saleDate: Date;
  phone: string;
  phoneDigits: string;
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
  items: ParsedSalesRow[];
}

export interface SalesControlTotals {
  sourceRows: number;
  validRows: number;
  skippedRows: number;
  saleItems: number;
  saleGroups: number;
  totalQuantity: string;
  totalAmountKgs: string;
}

export interface SalesValidationResult {
  ok: boolean;
  rawRows: RawSalesRow[];
  parsed: ParsedSalesRow[];
  issues: SalesValidationIssue[];
  groups: SalesGroup[];
  totals: SalesControlTotals;
  discrepancies: string[];
}

export function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
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
      trimmed.includes('ЦЕНА')
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

export function validateHistoricalSales(content: string): SalesValidationResult {
  const rawRows = parseHistoricalSalesTsv(content);
  const parsed: ParsedSalesRow[] = [];
  const issues: SalesValidationIssue[] = [];

  for (const row of rawRows) {
    if (!row.dateStr) {
      issues.push({ lineNumber: row.lineNumber, message: 'Missing date' });
      continue;
    }
    if (!row.phone) {
      issues.push({ lineNumber: row.lineNumber, message: 'Missing client phone' });
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

    const phoneDigits = normalizePhoneDigits(row.phone);
    if (phoneDigits.length < 9) {
      issues.push({
        lineNumber: row.lineNumber,
        message: `Invalid phone "${row.phone}"`,
      });
      continue;
    }

    const qty = roundQty(quantity);
    const unitPrice = roundMoney(unitPriceKgs);
    parsed.push({
      lineNumber: row.lineNumber,
      saleDate,
      phone: row.phone,
      phoneDigits,
      productName: row.productName,
      quantity: qty,
      unitPriceKgs: unitPrice,
      lineTotalKgs: roundMoney(qty.times(unitPrice)),
    });
  }

  const groups = groupHistoricalSales(parsed);
  const totalQuantity = parsed.reduce(
    (sum, row) => sum.plus(row.quantity),
    new Decimal(0),
  );
  const totalAmountKgs = parsed.reduce(
    (sum, row) => sum.plus(row.lineTotalKgs),
    new Decimal(0),
  );

  const totals: SalesControlTotals = {
    sourceRows: rawRows.length,
    validRows: parsed.length,
    skippedRows: rawRows.length - parsed.length,
    saleItems: parsed.length,
    saleGroups: groups.length,
    totalQuantity: totalQuantity.toFixed(),
    totalAmountKgs: totalAmountKgs.toFixed(2),
  };

  const discrepancies: string[] = [];
  if (totals.sourceRows !== EXPECTED_SOURCE_ROWS) {
    discrepancies.push(
      `Source rows: expected ${EXPECTED_SOURCE_ROWS}, got ${totals.sourceRows}`,
    );
  }
  if (totals.saleItems !== EXPECTED_SALE_ITEMS) {
    discrepancies.push(
      `Sale items: expected ${EXPECTED_SALE_ITEMS}, got ${totals.saleItems}`,
    );
  }
  if (totals.totalQuantity !== EXPECTED_TOTAL_QUANTITY) {
    discrepancies.push(
      `Total quantity: expected ${EXPECTED_TOTAL_QUANTITY}, got ${totals.totalQuantity}`,
    );
  }
  if (totals.totalAmountKgs !== EXPECTED_TOTAL_AMOUNT_KGS) {
    discrepancies.push(
      `Sales amount: expected ${EXPECTED_TOTAL_AMOUNT_KGS}, got ${totals.totalAmountKgs}`,
    );
  }

  return {
    ok: discrepancies.length === 0 && issues.length === 0,
    rawRows,
    parsed,
    issues,
    groups,
    totals,
    discrepancies,
  };
}

export function groupHistoricalSales(rows: ParsedSalesRow[]): SalesGroup[] {
  const map = new Map<string, SalesGroup>();

  for (const row of rows) {
    const dateKey = row.saleDate.toISOString().slice(0, 10);
    const key = `${dateKey}|${row.phoneDigits}`;
    const existing = map.get(key);
    if (existing) {
      existing.items.push(row);
    } else {
      map.set(key, {
        key,
        saleDate: row.saleDate,
        phone: row.phone,
        phoneDigits: row.phoneDigits,
        items: [row],
      });
    }
  }

  return [...map.values()].sort(
    (a, b) => a.saleDate.getTime() - b.saleDate.getTime(),
  );
}

export function printSalesValidationReport(result: SalesValidationResult): void {
  console.log('=== HISTORICAL SALES VALIDATION ===');
  console.log(`Source rows:        ${result.totals.sourceRows}`);
  console.log(`Valid sale items:   ${result.totals.saleItems}`);
  console.log(`Sale groups:        ${result.totals.saleGroups}`);
  console.log(`Total quantity:     ${result.totals.totalQuantity}`);
  console.log(`Sales amount:       ${result.totals.totalAmountKgs} сом`);
  console.log(`Validation issues:  ${result.issues.length}`);

  if (result.issues.length) {
    console.log('\nIssues:');
    for (const issue of result.issues) {
      console.log(`  line ${issue.lineNumber}: ${issue.message}`);
    }
  }

  if (result.discrepancies.length) {
    console.log('\nControl total discrepancies:');
    for (const line of result.discrepancies) {
      console.log(`  ${line}`);
    }
  }

  console.log(`\nStatus: ${result.ok ? 'PASS' : 'BLOCKED'}`);
}
