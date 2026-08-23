import { Prisma } from '@prisma/client';

export type ReconciliationStatus =
  | 'OK'
  | 'NEGATIVE_STOCK'
  | 'STOCK_MISMATCH'
  | 'MISSING_PURCHASE_HISTORY'
  | 'MISSING_OPENING_STOCK';

export type StockMovementKind =
  | 'PURCHASE_RECEIPT'
  | 'SALE'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'RETURN_IN'
  | 'RETURN_OUT';

export interface ProductMovementInput {
  date: Date;
  kind: StockMovementKind;
  quantityIn: Prisma.Decimal;
  quantityOut: Prisma.Decimal;
  reference?: string;
}

export interface ProductReconciliationInput {
  productId: string;
  productName: string;
  productCode: string;
  categoryId: string;
  categoryName: string;
  openingStock: Prisma.Decimal;
  purchasedQty: Prisma.Decimal;
  soldQty: Prisma.Decimal;
  adjustmentIn: Prisma.Decimal;
  adjustmentOut: Prisma.Decimal;
  purchaseAmountKgs: Prisma.Decimal;
  salesAmountKgs: Prisma.Decimal;
  cogsKgs: Prisma.Decimal | null;
  currentStock: Prisma.Decimal;
  movements?: ProductMovementInput[];
}

export interface ProductReconciliationResult {
  productId: string;
  productName: string;
  productCode: string;
  categoryId: string;
  categoryName: string;
  openingStock: Prisma.Decimal;
  purchasedQty: Prisma.Decimal;
  soldQty: Prisma.Decimal;
  adjustmentIn: Prisma.Decimal;
  adjustmentOut: Prisma.Decimal;
  calculatedStock: Prisma.Decimal;
  currentStock: Prisma.Decimal;
  difference: Prisma.Decimal;
  purchaseAmountKgs: Prisma.Decimal;
  salesAmountKgs: Prisma.Decimal;
  cogsKgs: Prisma.Decimal | null;
  grossMarginKgs: Prisma.Decimal | null;
  status: ReconciliationStatus;
  firstNegativeDate: string | null;
  negativeQty: Prisma.Decimal;
  requiredPurchaseQty: Prisma.Decimal;
  possibleCause: string | null;
}

const ZERO = new Prisma.Decimal(0);
const MISMATCH_EPSILON = new Prisma.Decimal('0.001');

export function calculateProductStock(input: {
  openingStock: Prisma.Decimal;
  purchasedQty: Prisma.Decimal;
  soldQty: Prisma.Decimal;
  adjustmentIn: Prisma.Decimal;
  adjustmentOut: Prisma.Decimal;
}): Prisma.Decimal {
  return input.openingStock
    .plus(input.purchasedQty)
    .plus(input.adjustmentIn)
    .minus(input.soldQty)
    .minus(input.adjustmentOut);
}

export function calculateRequiredPurchaseQty(input: {
  openingStock: Prisma.Decimal;
  purchasedQty: Prisma.Decimal;
  soldQty: Prisma.Decimal;
  adjustmentIn: Prisma.Decimal;
}): Prisma.Decimal {
  const required = input.soldQty
    .minus(input.openingStock)
    .minus(input.purchasedQty)
    .minus(input.adjustmentIn);
  return required.gt(ZERO) ? required : ZERO;
}

export function findFirstNegativeDate(
  openingStock: Prisma.Decimal,
  movements: ProductMovementInput[],
): { firstNegativeDate: string | null; negativeQty: Prisma.Decimal } {
  const sorted = [...movements].sort(
    (a, b) => compareBusinessDates(a.date, b.date) || 0,
  );

  let balance = openingStock;
  for (const movement of sorted) {
    balance = balance.plus(movement.quantityIn).minus(movement.quantityOut);
    if (balance.lt(ZERO)) {
      return {
        firstNegativeDate: formatIsoDate(movement.date),
        negativeQty: balance.abs(),
      };
    }
  }

  return { firstNegativeDate: null, negativeQty: ZERO };
}

export function buildChronologicalLedger(
  openingStock: Prisma.Decimal,
  movements: ProductMovementInput[],
): Array<{
  date: string;
  movementType: StockMovementKind;
  reference: string | null;
  quantityIn: string;
  quantityOut: string;
  runningBalance: string;
}> {
  const sorted = [...movements].sort(
    (a, b) => compareBusinessDates(a.date, b.date) || 0,
  );

  let balance = openingStock;
  const rows: Array<{
    date: string;
    movementType: StockMovementKind;
    reference: string | null;
    quantityIn: string;
    quantityOut: string;
    runningBalance: string;
  }> = [];

  for (const movement of sorted) {
    balance = balance.plus(movement.quantityIn).minus(movement.quantityOut);
    rows.push({
      date: formatIsoDate(movement.date),
      movementType: movement.kind,
      reference: movement.reference ?? null,
      quantityIn: decimalString(movement.quantityIn),
      quantityOut: decimalString(movement.quantityOut),
      runningBalance: decimalString(balance),
    });
  }

  return rows;
}

export function resolveReconciliationStatus(input: {
  calculatedStock: Prisma.Decimal;
  currentStock: Prisma.Decimal;
  difference: Prisma.Decimal;
  requiredPurchaseQty: Prisma.Decimal;
  soldQty: Prisma.Decimal;
  purchasedQty: Prisma.Decimal;
  openingStock: Prisma.Decimal;
  firstNegativeDate: string | null;
  firstPurchaseDate: string | null;
  firstSaleDate: string | null;
}): { status: ReconciliationStatus; possibleCause: string | null } {
  const hasMismatch = input.difference.abs().gt(MISMATCH_EPSILON);

  if (hasMismatch) {
    return {
      status: 'STOCK_MISMATCH',
      possibleCause: 'Calculated stock does not match system inventory quantity',
    };
  }

  if (input.calculatedStock.lt(ZERO)) {
    if (input.requiredPurchaseQty.gt(ZERO)) {
      return {
        status: 'MISSING_PURCHASE_HISTORY',
        possibleCause: 'Missing historical purchase/receipt data',
      };
    }

    if (
      input.openingStock.eq(ZERO) &&
      input.firstSaleDate &&
      input.firstPurchaseDate &&
      input.firstSaleDate < input.firstPurchaseDate
    ) {
      return {
        status: 'MISSING_OPENING_STOCK',
        possibleCause: 'Sales occurred before first warehouse receipt; opening stock may be missing',
      };
    }

    return {
      status: 'NEGATIVE_STOCK',
      possibleCause: 'Calculated stock is negative',
    };
  }

  return { status: 'OK', possibleCause: null };
}

export function reconcileProduct(
  input: ProductReconciliationInput,
): ProductReconciliationResult {
  const calculatedStock = calculateProductStock(input);
  const difference = calculatedStock.minus(input.currentStock);
  const requiredPurchaseQty = calculateRequiredPurchaseQty(input);

  const movements = input.movements ?? [];
  const { firstNegativeDate, negativeQty } = findFirstNegativeDate(
    input.openingStock,
    movements,
  );

  const firstPurchaseDate = firstMovementDate(movements, (m) =>
    m.kind === 'PURCHASE_RECEIPT' ? m.date : null,
  );
  const firstSaleDate = firstMovementDate(movements, (m) =>
    m.kind === 'SALE' ? m.date : null,
  );

  const { status, possibleCause } = resolveReconciliationStatus({
    calculatedStock,
    currentStock: input.currentStock,
    difference,
    requiredPurchaseQty,
    soldQty: input.soldQty,
    purchasedQty: input.purchasedQty,
    openingStock: input.openingStock,
    firstNegativeDate,
    firstPurchaseDate,
    firstSaleDate,
  });

  const grossMarginKgs =
    input.cogsKgs != null
      ? input.salesAmountKgs.minus(input.cogsKgs)
      : null;

  return {
    productId: input.productId,
    productName: input.productName,
    productCode: input.productCode,
    categoryId: input.categoryId,
    categoryName: input.categoryName,
    openingStock: input.openingStock,
    purchasedQty: input.purchasedQty,
    soldQty: input.soldQty,
    adjustmentIn: input.adjustmentIn,
    adjustmentOut: input.adjustmentOut,
    calculatedStock,
    currentStock: input.currentStock,
    difference,
    purchaseAmountKgs: input.purchaseAmountKgs,
    salesAmountKgs: input.salesAmountKgs,
    cogsKgs: input.cogsKgs,
    grossMarginKgs,
    status,
    firstNegativeDate,
    negativeQty: calculatedStock.lt(ZERO) ? calculatedStock.abs() : negativeQty,
    requiredPurchaseQty,
    possibleCause,
  };
}

export function matchesStatusFilter(
  status: ReconciliationStatus,
  filter: string | undefined,
): boolean {
  if (!filter || filter === 'ALL') return true;
  switch (filter) {
    case 'OK':
      return status === 'OK';
    case 'NEGATIVE_STOCK':
      return status === 'NEGATIVE_STOCK';
    case 'STOCK_MISMATCH':
      return status === 'STOCK_MISMATCH';
    case 'MISSING_PURCHASE_HISTORY':
      return status === 'MISSING_PURCHASE_HISTORY';
    case 'MISSING_OPENING_STOCK':
      return status === 'MISSING_OPENING_STOCK';
    default:
      return true;
  }
}

function firstMovementDate(
  movements: ProductMovementInput[],
  pick: (movement: ProductMovementInput) => Date | null,
): string | null {
  let earliest: Date | null = null;
  for (const movement of movements) {
    const date = pick(movement);
    if (!date) continue;
    if (!earliest || compareBusinessDates(date, earliest) < 0) {
      earliest = date;
    }
  }
  return earliest ? formatIsoDate(earliest) : null;
}

function compareBusinessDates(a: Date, b: Date): number {
  const aDay = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const bDay = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return aDay - bDay;
}

function formatIsoDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function decimalString(value: Prisma.Decimal): string {
  return value.toFixed(3);
}
