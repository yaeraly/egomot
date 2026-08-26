import { Decimal, moneyStr, roundMoney } from '../purchases/purchase-calc';
import {
  ACCOUNT_CODE,
  EXPENSE_CATEGORY_ACCOUNT_CODE,
  OPENING_INVESTOR_CAPITAL_KGS,
  type AccountCode,
  type OperatingExpenseCategoryCode,
} from './accounting-codes';

export type JournalLineDraft = {
  accountCode: string;
  debitKgs: string;
  creditKgs: string;
  memo?: string;
  paymentAccountId?: string | null;
};

export class UnbalancedJournalError extends Error {
  constructor(
    readonly debitKgs: string,
    readonly creditKgs: string,
  ) {
    super(`Journal is unbalanced: debit ${debitKgs} != credit ${creditKgs}`);
    this.name = 'UnbalancedJournalError';
  }
}

export class InvalidJournalLineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidJournalLineError';
  }
}

export type PayableStatusCode = 'UNPAID' | 'PARTIAL' | 'PAID';

export function line(accountCode: string, debit: Decimal.Value, credit: Decimal.Value, memo?: string): JournalLineDraft {
  return {
    accountCode,
    debitKgs: moneyStr(debit),
    creditKgs: moneyStr(credit),
    memo,
  };
}

export function validateJournalLines(lines: JournalLineDraft[]): {
  debitKgs: Decimal;
  creditKgs: Decimal;
} {
  if (lines.length < 2) {
    throw new InvalidJournalLineError('Journal must have at least two lines');
  }

  let debit = roundMoney(0);
  let credit = roundMoney(0);

  for (const [index, row] of lines.entries()) {
    const debitAmount = roundMoney(row.debitKgs);
    const creditAmount = roundMoney(row.creditKgs);
    if (debitAmount.lt(0) || creditAmount.lt(0)) {
      throw new InvalidJournalLineError(`Journal line ${index + 1} cannot be negative`);
    }
    if (debitAmount.gt(0) && creditAmount.gt(0)) {
      throw new InvalidJournalLineError(
        `Journal line ${index + 1} cannot have both debit and credit`,
      );
    }
    if (debitAmount.eq(0) && creditAmount.eq(0)) {
      throw new InvalidJournalLineError(`Journal line ${index + 1} is empty`);
    }
    if (!row.accountCode?.trim()) {
      throw new InvalidJournalLineError(`Journal line ${index + 1} is missing account code`);
    }
    debit = debit.plus(debitAmount);
    credit = credit.plus(creditAmount);
  }

  debit = roundMoney(debit);
  credit = roundMoney(credit);
  if (!debit.eq(credit)) {
    throw new UnbalancedJournalError(moneyStr(debit), moneyStr(credit));
  }
  return { debitKgs: debit, creditKgs: credit };
}

export function compactLines(lines: JournalLineDraft[]): JournalLineDraft[] {
  const merged = new Map<string, { debit: Decimal; credit: Decimal; memo?: string }>();
  for (const row of lines) {
    const key = `${row.accountCode}|${row.paymentAccountId ?? ''}|${row.memo ?? ''}`;
    const current = merged.get(key) ?? { debit: roundMoney(0), credit: roundMoney(0), memo: row.memo };
    current.debit = current.debit.plus(roundMoney(row.debitKgs));
    current.credit = current.credit.plus(roundMoney(row.creditKgs));
    merged.set(key, current);
  }
  return [...merged.entries()].map(([key, value]) => {
    const [accountCode, paymentAccountId] = key.split('|');
    const netDebit = roundMoney(Decimal.max(0, value.debit.minus(value.credit)));
    const netCredit = roundMoney(Decimal.max(0, value.credit.minus(value.debit)));
    return {
      accountCode,
      debitKgs: moneyStr(netDebit),
      creditKgs: moneyStr(netCredit),
      memo: value.memo,
      paymentAccountId: paymentAccountId || null,
    };
  }).filter((row) => !roundMoney(row.debitKgs).eq(0) || !roundMoney(row.creditKgs).eq(0));
}

export function reverseJournalLines(lines: JournalLineDraft[]): JournalLineDraft[] {
  return lines.map((row) => ({
    ...row,
    debitKgs: row.creditKgs,
    creditKgs: row.debitKgs,
  }));
}

export function buildOpeningInvestorCapitalLines(
  amountKgs: Decimal.Value = OPENING_INVESTOR_CAPITAL_KGS,
): JournalLineDraft[] {
  const amount = roundMoney(amountKgs);
  if (!amount.gt(0)) {
    throw new InvalidJournalLineError('Opening investor capital must be greater than zero');
  }
  return [
    line(ACCOUNT_CODE.CASH, amount, 0, 'Opening investor capital'),
    line(ACCOUNT_CODE.INVESTOR_CAPITAL, 0, amount, 'Opening investor capital'),
  ];
}

/** Cash purchase: inventory acquired and paid immediately. Does not invent historical payments. */
export function buildCashPurchaseLines(inventoryKgs: Decimal.Value): JournalLineDraft[] {
  const amount = requirePositive(inventoryKgs, 'Cash purchase amount');
  return [
    line(ACCOUNT_CODE.INVENTORY, amount, 0, 'Cash purchase'),
    line(ACCOUNT_CODE.CASH, 0, amount, 'Cash purchase'),
  ];
}

/** Credit purchase: inventory acquired, supplier unpaid. */
export function buildCreditPurchaseLines(inventoryKgs: Decimal.Value): JournalLineDraft[] {
  const amount = requirePositive(inventoryKgs, 'Credit purchase amount');
  return [
    line(ACCOUNT_CODE.INVENTORY, amount, 0, 'Credit purchase'),
    line(ACCOUNT_CODE.SUPPLIER_AP, 0, amount, 'Credit purchase'),
  ];
}

/** Partial purchase: part cash, remainder supplier AP. */
export function buildPartialPurchaseLines(params: {
  inventoryKgs: Decimal.Value;
  paidKgs: Decimal.Value;
}): JournalLineDraft[] {
  const inventory = requirePositive(params.inventoryKgs, 'Partial purchase inventory');
  const paid = roundMoney(params.paidKgs);
  if (paid.lt(0) || paid.gt(inventory)) {
    throw new InvalidJournalLineError('Partial purchase paid amount is out of range');
  }
  const unpaid = roundMoney(inventory.minus(paid));
  const lines: JournalLineDraft[] = [
    line(ACCOUNT_CODE.INVENTORY, inventory, 0, 'Partial purchase'),
  ];
  if (paid.gt(0)) {
    lines.push(line(ACCOUNT_CODE.CASH, 0, paid, 'Partial purchase cash'));
  }
  if (unpaid.gt(0)) {
    lines.push(line(ACCOUNT_CODE.SUPPLIER_AP, 0, unpaid, 'Partial purchase payable'));
  }
  return lines;
}

/**
 * Recognize landed inventory on a completed receipt.
 * Cargo is capitalized into inventory and credited to cargo AP when unpaid.
 * Supplier portion (goods + non-cargo transport) is split:
 *   paidSupplierKgs credits Cash/Bank (only when an actual payment amount is provided)
 *   remainder credits supplier AP.
 * paidSupplierKgs defaults to 0 — never invent a historical payment.
 */
export function buildPurchaseReceiptLines(params: {
  inventoryKgs: Decimal.Value;
  cargoKgs?: Decimal.Value;
  paidSupplierKgs?: Decimal.Value;
  cashAccountCode?: AccountCode;
}): JournalLineDraft[] {
  const inventory = requirePositive(params.inventoryKgs, 'Receipt inventory');
  const cargo = roundMoney(params.cargoKgs ?? 0);
  if (cargo.lt(0) || cargo.gt(inventory)) {
    throw new InvalidJournalLineError('Cargo amount is out of range for landed inventory');
  }
  const supplierPortion = roundMoney(inventory.minus(cargo));
  const paid = roundMoney(params.paidSupplierKgs ?? 0);
  if (paid.lt(0) || paid.gt(supplierPortion)) {
    throw new InvalidJournalLineError('Receipt supplier paid amount is out of range');
  }
  const unpaid = roundMoney(supplierPortion.minus(paid));
  const cashCode = params.cashAccountCode ?? ACCOUNT_CODE.CASH;
  const lines: JournalLineDraft[] = [
    line(ACCOUNT_CODE.INVENTORY, inventory, 0, 'Purchase receipt landed cost'),
  ];
  if (paid.gt(0)) {
    lines.push(line(cashCode, 0, paid, 'Purchase cash'));
  }
  if (unpaid.gt(0)) {
    lines.push(line(ACCOUNT_CODE.SUPPLIER_AP, 0, unpaid, 'Supplier payable'));
  }
  if (cargo.gt(0)) {
    lines.push(line(ACCOUNT_CODE.CARGO_AP, 0, cargo, 'Cargo payable'));
  }
  return lines;
}

export function buildCargoPayableLines(cargoKgs: Decimal.Value): JournalLineDraft[] {
  const amount = requirePositive(cargoKgs, 'Cargo payable');
  return [
    line(ACCOUNT_CODE.INVENTORY, amount, 0, 'Unpaid cargo capitalized'),
    line(ACCOUNT_CODE.CARGO_AP, 0, amount, 'Cargo payable'),
  ];
}

export function buildSupplierApPaymentLines(params: {
  amountKgs: Decimal.Value;
  cashAccountCode?: AccountCode;
}): JournalLineDraft[] {
  const amount = requirePositive(params.amountKgs, 'Supplier AP payment');
  const cashCode = params.cashAccountCode ?? ACCOUNT_CODE.CASH;
  return [
    line(ACCOUNT_CODE.SUPPLIER_AP, amount, 0, 'Supplier payment'),
    line(cashCode, 0, amount, 'Supplier payment'),
  ];
}

export function buildCargoPaymentLines(params: {
  amountKgs: Decimal.Value;
  cashAccountCode?: AccountCode;
}): JournalLineDraft[] {
  const amount = requirePositive(params.amountKgs, 'Cargo payment');
  const cashCode = params.cashAccountCode ?? ACCOUNT_CODE.CASH;
  return [
    line(ACCOUNT_CODE.CARGO_AP, amount, 0, 'Cargo payment'),
    line(cashCode, 0, amount, 'Cargo payment'),
  ];
}

export function buildSaleLines(params: {
  revenueKgs: Decimal.Value;
  paidKgs?: Decimal.Value;
  cogsKgs: Decimal.Value;
  cashAccountCode?: AccountCode;
  cashByAccountCode?: Record<string, Decimal.Value>;
}): JournalLineDraft[] {
  const revenue = requirePositive(params.revenueKgs, 'Sale revenue');
  const cogs = roundMoney(params.cogsKgs);
  if (cogs.lt(0)) {
    throw new InvalidJournalLineError('COGS cannot be negative');
  }

  const cashSplits = params.cashByAccountCode
    ? Object.entries(params.cashByAccountCode).map(([code, amount]) => ({
        code,
        amount: roundMoney(amount),
      }))
    : [
        {
          code: params.cashAccountCode ?? ACCOUNT_CODE.CASH,
          amount: roundMoney(params.paidKgs ?? 0),
        },
      ];

  const paid = roundMoney(
    cashSplits.reduce((sum, row) => sum.plus(row.amount), roundMoney(0)),
  );
  if (paid.lt(0) || paid.gt(revenue)) {
    throw new InvalidJournalLineError('Sale paid amount is out of range');
  }
  const unpaid = roundMoney(revenue.minus(paid));

  const lines: JournalLineDraft[] = [];
  for (const split of cashSplits) {
    if (split.amount.gt(0)) {
      lines.push(line(split.code, split.amount, 0, 'Sale cash'));
    }
  }
  if (unpaid.gt(0)) {
    lines.push(line(ACCOUNT_CODE.AR, unpaid, 0, 'Sale on credit'));
  }
  lines.push(line(ACCOUNT_CODE.SALES_REVENUE, 0, revenue, 'Sales revenue'));
  if (cogs.gt(0)) {
    lines.push(line(ACCOUNT_CODE.COGS, cogs, 0, 'Cost of goods sold'));
    lines.push(line(ACCOUNT_CODE.INVENTORY, 0, cogs, 'Inventory relief'));
  }
  return lines;
}

/** Revenue-only sale journal (no COGS). Used by historical backfill SALE_REVENUE. */
export function buildSaleRevenueLines(params: {
  revenueKgs: Decimal.Value;
  paidKgs?: Decimal.Value;
  cashAccountCode?: AccountCode;
  cashByAccountCode?: Record<string, Decimal.Value>;
}): JournalLineDraft[] {
  return buildSaleLines({
    revenueKgs: params.revenueKgs,
    paidKgs: params.paidKgs,
    cogsKgs: 0,
    cashAccountCode: params.cashAccountCode,
    cashByAccountCode: params.cashByAccountCode,
  });
}

export function buildCogsInventoryLines(cogsKgs: Decimal.Value): JournalLineDraft[] {
  const cogs = requirePositive(cogsKgs, 'COGS');
  return [
    line(ACCOUNT_CODE.COGS, cogs, 0, 'Cost of goods sold'),
    line(ACCOUNT_CODE.INVENTORY, 0, cogs, 'Inventory relief'),
  ];
}

export function buildCashSaleLines(params: {
  revenueKgs: Decimal.Value;
  cogsKgs: Decimal.Value;
  cashAccountCode?: AccountCode;
}): JournalLineDraft[] {
  return buildSaleLines({
    revenueKgs: params.revenueKgs,
    paidKgs: params.revenueKgs,
    cogsKgs: params.cogsKgs,
    cashAccountCode: params.cashAccountCode,
  });
}

export function buildCreditSaleLines(params: {
  revenueKgs: Decimal.Value;
  cogsKgs: Decimal.Value;
}): JournalLineDraft[] {
  return buildSaleLines({
    revenueKgs: params.revenueKgs,
    paidKgs: 0,
    cogsKgs: params.cogsKgs,
  });
}

export function buildDebtCollectionLines(params: {
  amountKgs: Decimal.Value;
  cashAccountCode?: AccountCode;
}): JournalLineDraft[] {
  const amount = requirePositive(params.amountKgs, 'Debt collection');
  const cashCode = params.cashAccountCode ?? ACCOUNT_CODE.CASH;
  return [
    line(cashCode, amount, 0, 'Customer debt collection'),
    line(ACCOUNT_CODE.AR, 0, amount, 'Customer debt collection'),
  ];
}

export function buildOperatingExpenseLines(params: {
  category: OperatingExpenseCategoryCode;
  amountKgs: Decimal.Value;
  cashAccountCode?: AccountCode;
}): JournalLineDraft[] {
  const amount = requirePositive(params.amountKgs, 'Operating expense');
  const expenseCode = EXPENSE_CATEGORY_ACCOUNT_CODE[params.category];
  const cashCode = params.cashAccountCode ?? ACCOUNT_CODE.CASH;
  return [
    line(expenseCode, amount, 0, `Operating expense ${params.category}`),
    line(cashCode, 0, amount, `Operating expense ${params.category}`),
  ];
}

export function buildOwnerSalaryLines(params: {
  amountKgs: Decimal.Value;
  cashAccountCode?: AccountCode;
}): JournalLineDraft[] {
  return buildOperatingExpenseLines({
    category: 'OWNER_SALARY',
    amountKgs: params.amountKgs,
    cashAccountCode: params.cashAccountCode,
  });
}

export function buildOwnerWithdrawalLines(params: {
  amountKgs: Decimal.Value;
  cashAccountCode?: AccountCode;
}): JournalLineDraft[] {
  const amount = requirePositive(params.amountKgs, 'Owner withdrawal');
  const cashCode = params.cashAccountCode ?? ACCOUNT_CODE.CASH;
  return [
    line(ACCOUNT_CODE.OWNER_DRAWINGS, amount, 0, 'Owner withdrawal'),
    line(cashCode, 0, amount, 'Owner withdrawal'),
  ];
}

export function saleCogsFromItems(
  items: Array<{ quantity: Decimal.Value; unitCostKgs: Decimal.Value }>,
): Decimal {
  return roundMoney(
    items.reduce(
      (sum, item) => sum.plus(roundMoney(roundMoney(item.unitCostKgs).times(item.quantity))),
      roundMoney(0),
    ),
  );
}

export function payableStatusFromAmounts(
  amountKgs: Decimal.Value,
  paidAmountKgs: Decimal.Value,
): PayableStatusCode {
  const amount = roundMoney(amountKgs);
  const paid = roundMoney(paidAmountKgs);
  if (paid.lte(0)) return 'UNPAID';
  if (paid.gte(amount)) return 'PAID';
  return 'PARTIAL';
}

export function remainingPayableAmount(
  amountKgs: Decimal.Value,
  paidAmountKgs: Decimal.Value,
): Decimal {
  return Decimal.max(0, roundMoney(roundMoney(amountKgs).minus(roundMoney(paidAmountKgs))));
}

export function reconcileSubledgerToGl(params: {
  subledgerRemainingKgs: Decimal.Value;
  glBalanceKgs: Decimal.Value;
}): { ok: boolean; subledgerRemainingKgs: string; glBalanceKgs: string; differenceKgs: string } {
  const subledger = roundMoney(params.subledgerRemainingKgs);
  const gl = roundMoney(params.glBalanceKgs);
  const difference = roundMoney(subledger.minus(gl));
  return {
    ok: difference.eq(0),
    subledgerRemainingKgs: moneyStr(subledger),
    glBalanceKgs: moneyStr(gl),
    differenceKgs: moneyStr(difference),
  };
}

/** Asset / expense / COGS normal debit balance. */
export function debitNormalBalance(
  lines: Array<{ accountCode: string; debitKgs: Decimal.Value; creditKgs: Decimal.Value }>,
  accountCode: string,
): Decimal {
  return roundMoney(
    lines
      .filter((row) => row.accountCode === accountCode)
      .reduce(
        (sum, row) => sum.plus(roundMoney(row.debitKgs)).minus(roundMoney(row.creditKgs)),
        roundMoney(0),
      ),
  );
}

export function grossDebit(
  lines: Array<{ accountCode: string; debitKgs: Decimal.Value; creditKgs: Decimal.Value }>,
  accountCode: string,
): Decimal {
  return roundMoney(
    lines
      .filter((row) => row.accountCode === accountCode)
      .reduce((sum, row) => sum.plus(roundMoney(row.debitKgs)), roundMoney(0)),
  );
}

export function grossCredit(
  lines: Array<{ accountCode: string; debitKgs: Decimal.Value; creditKgs: Decimal.Value }>,
  accountCode: string,
): Decimal {
  return roundMoney(
    lines
      .filter((row) => row.accountCode === accountCode)
      .reduce((sum, row) => sum.plus(roundMoney(row.creditKgs)), roundMoney(0)),
  );
}

/** Liability / equity / income normal credit balance. */
export function creditNormalBalance(
  lines: Array<{ accountCode: string; debitKgs: Decimal.Value; creditKgs: Decimal.Value }>,
  accountCode: string,
): Decimal {
  return roundMoney(
    lines
      .filter((row) => row.accountCode === accountCode)
      .reduce(
        (sum, row) => sum.plus(roundMoney(row.creditKgs)).minus(roundMoney(row.debitKgs)),
        roundMoney(0),
      ),
  );
}

export function formatJournalNumber(year: number, seq: number): string {
  return `J-${year}-${String(seq).padStart(4, '0')}`;
}

function requirePositive(value: Decimal.Value, label: string): Decimal {
  const amount = roundMoney(value);
  if (!amount.gt(0)) {
    throw new InvalidJournalLineError(`${label} must be greater than zero`);
  }
  return amount;
}
