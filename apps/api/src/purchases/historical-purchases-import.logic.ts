import Decimal from 'decimal.js';
import {
  normalizeHistoricalField,
  parseDelimitedRow,
  resolveProductName,
} from '../sales/historical-sales-import.logic';

export interface RawPurchaseRow {
  lineNumber: number;
  purchaseDateStr: string;
  warehouseReceiptDateStr: string;
  supplierName: string;
  productName: string;
  quantityStr: string;
  unitPriceStr: string;
  totalAmountStr: string;
}

export interface ParsedPurchaseRow {
  lineNumber: number;
  purchaseDate: Date;
  warehouseReceiptDate: Date;
  supplierName: string;
  productName: string;
  quantity: Decimal;
  unitPriceKgs: Decimal;
  totalAmountKgs: Decimal;
}

export interface PurchaseValidationIssue {
  lineNumber: number;
  message: string;
}

export interface PurchaseValidationResult {
  ok: boolean;
  rawRows: RawPurchaseRow[];
  parsed: ParsedPurchaseRow[];
  issues: PurchaseValidationIssue[];
  totals: {
    sourceRows: number;
    validRows: number;
    totalQuantity: string;
    totalAmountKgs: string;
  };
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

function parseBusinessDate(dateStr: string): Date | null {
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

export function parseHistoricalPurchasesTsv(content: string): RawPurchaseRow[] {
  const lines = content.split(/\r?\n/);
  const rows: RawPurchaseRow[] = [];
  let lineNumber = 0;

  for (const line of lines) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (
      trimmed.toLowerCase().includes('purchase date') ||
      trimmed.toLowerCase().includes('warehouse receipt')
    ) {
      continue;
    }

    const parts = parseDelimitedRow(line);
    if (parts.length < 7) continue;

    rows.push({
      lineNumber,
      purchaseDateStr: normalizeHistoricalField(parts[0]),
      warehouseReceiptDateStr: normalizeHistoricalField(parts[1]),
      supplierName: normalizeHistoricalField(parts[2]),
      productName: normalizeHistoricalField(parts[3]),
      quantityStr: normalizeHistoricalField(parts[4]),
      unitPriceStr: normalizeHistoricalField(parts[5]),
      totalAmountStr: normalizeHistoricalField(parts[6]),
    });
  }

  return rows;
}

export function validateHistoricalPurchases(content: string): PurchaseValidationResult {
  const rawRows = parseHistoricalPurchasesTsv(content);
  const parsed: ParsedPurchaseRow[] = [];
  const issues: PurchaseValidationIssue[] = [];

  for (const row of rawRows) {
    const purchaseDate = parseBusinessDate(row.purchaseDateStr);
    const warehouseReceiptDate = parseBusinessDate(row.warehouseReceiptDateStr);
    if (!purchaseDate) {
      issues.push({
        lineNumber: row.lineNumber,
        message: `Invalid purchase date "${row.purchaseDateStr}"`,
      });
      continue;
    }
    if (!warehouseReceiptDate) {
      issues.push({
        lineNumber: row.lineNumber,
        message: `Invalid warehouse receipt date "${row.warehouseReceiptDateStr}"`,
      });
      continue;
    }
    if (warehouseReceiptDate.getTime() < purchaseDate.getTime()) {
      issues.push({
        lineNumber: row.lineNumber,
        message: 'Warehouse receipt date is before purchase date',
      });
      continue;
    }
    if (!row.supplierName) {
      issues.push({ lineNumber: row.lineNumber, message: 'Missing supplier' });
      continue;
    }
    if (!row.productName) {
      issues.push({ lineNumber: row.lineNumber, message: 'Missing product' });
      continue;
    }

    const quantity = parseQuantity(row.quantityStr);
    if (quantity === null || quantity.lte(0)) {
      issues.push({
        lineNumber: row.lineNumber,
        message: `Invalid quantity "${row.quantityStr}"`,
      });
      continue;
    }

    const unitPriceKgs = parseMoney(row.unitPriceStr);
    if (unitPriceKgs === null || unitPriceKgs.lte(0)) {
      issues.push({
        lineNumber: row.lineNumber,
        message: `Invalid unit price "${row.unitPriceStr}"`,
      });
      continue;
    }

    const qty = roundQty(quantity);
    const unitPrice = roundMoney(unitPriceKgs);
    const computedTotal = roundMoney(qty.times(unitPrice));
    const providedTotal = row.totalAmountStr
      ? parseMoney(row.totalAmountStr)
      : null;
    const totalAmountKgs =
      providedTotal && providedTotal.gt(0) ? roundMoney(providedTotal) : computedTotal;

    parsed.push({
      lineNumber: row.lineNumber,
      purchaseDate,
      warehouseReceiptDate,
      supplierName: row.supplierName,
      productName: resolveProductName(row.productName),
      quantity: qty,
      unitPriceKgs: unitPrice,
      totalAmountKgs,
    });
  }

  const totalQuantity = parsed.reduce(
    (sum, row) => sum.plus(row.quantity),
    new Decimal(0),
  );
  const totalAmountKgs = parsed.reduce(
    (sum, row) => sum.plus(row.totalAmountKgs),
    new Decimal(0),
  );

  return {
    ok: issues.length === 0 && parsed.length > 0,
    rawRows,
    parsed,
    issues,
    totals: {
      sourceRows: rawRows.length,
      validRows: parsed.length,
      totalQuantity: totalQuantity.toFixed(),
      totalAmountKgs: totalAmountKgs.toFixed(2),
    },
  };
}

export function printPurchaseValidationReport(result: PurchaseValidationResult): void {
  console.log('=== HISTORICAL PURCHASES VALIDATION ===');
  console.log(`Source rows:        ${result.totals.sourceRows}`);
  console.log(`Valid rows:         ${result.totals.validRows}`);
  console.log(`Purchased quantity: ${result.totals.totalQuantity}`);
  console.log(`Purchase amount:    ${result.totals.totalAmountKgs} сом`);
  console.log(`Validation issues:  ${result.issues.length}`);

  if (result.issues.length) {
    console.log('\nIssues:');
    for (const issue of result.issues.slice(0, 20)) {
      console.log(`  line ${issue.lineNumber}: ${issue.message}`);
    }
    if (result.issues.length > 20) {
      console.log(`  ... and ${result.issues.length - 20} more`);
    }
  }

  console.log(`\nStatus: ${result.ok ? 'PASS' : 'BLOCKED'}`);
}
