import { ACCOUNT_CODE } from './accounting-codes';
import {
  buildCreditPurchaseLines,
  buildPartialPurchaseLines,
  buildSupplierApPaymentLines,
  creditNormalBalance,
  debitNormalBalance,
  payableStatusFromAmounts,
  remainingPayableAmount,
  validateJournalLines,
} from './accounting-journal.logic';
import {
  buildBalanceSheet,
  buildCashFlowStatement,
  buildProfitAndLoss,
  classifyJournalCashFlow,
  type PostedReportJournal,
} from './accounting-reports.logic';

const DAY1 = new Date('2026-01-01T00:00:00.000Z');
const DAY2 = new Date('2026-01-05T00:00:00.000Z');
const DAY3 = new Date('2026-01-10T00:00:00.000Z');

function journal(
  postedAt: Date,
  lines: ReturnType<typeof buildSupplierApPaymentLines>,
  sourceType = 'PURCHASE_PAYMENT',
): PostedReportJournal {
  validateJournalLines(lines);
  return { postedAt, sourceType, status: 'POSTED', lines };
}

function receiptWithSupplierDebt(amountKgs: string, paidAtReceiptKgs = '0') {
  if (paidAtReceiptKgs === '0') {
    return buildCreditPurchaseLines(amountKgs);
  }
  return buildPartialPurchaseLines({ inventoryKgs: amountKgs, paidKgs: paidAtReceiptKgs });
}

function validateUiPaymentAmount(amountKgs: string, remainingAmountKgs: string): string | null {
  const amount = Number(amountKgs);
  const remaining = Number(remainingAmountKgs);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 'Сумма оплаты должна быть больше 0';
  }
  if (amount > remaining) {
    return 'Сумма оплаты не может превышать остаток долга';
  }
  return null;
}

describe('supplier debt payment (PurchasePayment UI flow)', () => {
  it('1. payment modal defaults to remaining debt for partial settlement', () => {
    const remaining = remainingPayableAmount('100000', '0');
    expect(remaining.toFixed(2)).toBe('100000.00');
    expect(validateUiPaymentAmount('100000', remaining.toFixed(2))).toBeNull();
  });

  it('2. partial payment: 40,000 of 100,000 leaves PARTIAL status and 60,000 remaining', () => {
    const receipt = receiptWithSupplierDebt('100000');
    const payment = buildSupplierApPaymentLines({ amountKgs: '40000' });
    const posted = [...receipt, ...payment];
    const status = payableStatusFromAmounts('100000', '40000');
    const remaining = remainingPayableAmount('100000', '40000');
    expect(status).toBe('PARTIAL');
    expect(remaining.toFixed(2)).toBe('60000.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('60000.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.CASH).toFixed(2)).toBe('40000.00');
  });

  it('3. full payment clears supplier AP', () => {
    const receipt = receiptWithSupplierDebt('60000', '0');
    const payment = buildSupplierApPaymentLines({ amountKgs: '60000' });
    const posted = [...receipt, ...payment];
    expect(payableStatusFromAmounts('60000', '60000')).toBe('PAID');
    expect(remainingPayableAmount('60000', '60000').toFixed(2)).toBe('0.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('0.00');
  });

  it('4. payment greater than remaining is blocked in UI validation', () => {
    expect(validateUiPaymentAmount('100001', '100000')).toBe(
      'Сумма оплаты не может превышать остаток долга',
    );
  });

  it('5. zero payment is blocked in UI validation', () => {
    expect(validateUiPaymentAmount('0', '100000')).toBe('Сумма оплаты должна быть больше 0');
    expect(validateUiPaymentAmount('-100', '100000')).toBe('Сумма оплаты должна быть больше 0');
  });

  it('6. company cash payment credits account 1000', () => {
    const lines = buildSupplierApPaymentLines({
      amountKgs: '40000',
      cashAccountCode: ACCOUNT_CODE.CASH,
    });
    expect(creditNormalBalance(lines, ACCOUNT_CODE.CASH).toFixed(2)).toBe('40000.00');
    expect(debitNormalBalance(lines, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('40000.00');
  });

  it('7. company bank payment credits account 1010', () => {
    const lines = buildSupplierApPaymentLines({
      amountKgs: '40000',
      cashAccountCode: ACCOUNT_CODE.BANK,
    });
    expect(creditNormalBalance(lines, ACCOUNT_CODE.BANK).toFixed(2)).toBe('40000.00');
    expect(debitNormalBalance(lines, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('40000.00');
  });

  it('8. supplier AP decreases by payment amount', () => {
    const receipt = receiptWithSupplierDebt('100000');
    const first = buildSupplierApPaymentLines({ amountKgs: '40000' });
    const afterFirst = [...receipt, ...first];
    expect(creditNormalBalance(afterFirst, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('60000.00');
    const second = buildSupplierApPaymentLines({ amountKgs: '60000' });
    const afterSecond = [...afterFirst, ...second];
    expect(creditNormalBalance(afterSecond, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('0.00');
  });

  it('9. cash/bank decreases by payment amount', () => {
    const openingCash = '2000000.00';
    const opening = [
      { accountCode: ACCOUNT_CODE.CASH, debitKgs: openingCash, creditKgs: '0.00' },
      {
        accountCode: ACCOUNT_CODE.INVESTOR_CAPITAL,
        debitKgs: '0.00',
        creditKgs: openingCash,
      },
    ];
    const receipt = receiptWithSupplierDebt('100000');
    const payment = buildSupplierApPaymentLines({ amountKgs: '40000' });
    const posted = [...opening, ...receipt, ...payment];
    expect(debitNormalBalance(posted, ACCOUNT_CODE.CASH).toFixed(2)).toBe('1960000.00');
  });

  it('10. inventory is unchanged by supplier debt repayment', () => {
    const receipt = receiptWithSupplierDebt('100000', '0');
    const payment = buildSupplierApPaymentLines({ amountKgs: '40000' });
    const before = debitNormalBalance(receipt, ACCOUNT_CODE.INVENTORY);
    const after = debitNormalBalance([...receipt, ...payment], ACCOUNT_CODE.INVENTORY);
    expect(before.toFixed(2)).toBe('100000.00');
    expect(after.toFixed(2)).toBe('100000.00');
  });

  it('11. ОПУ is unchanged by supplier debt repayment', () => {
    const receipt = receiptWithSupplierDebt('100000');
    const payment = buildSupplierApPaymentLines({ amountKgs: '40000' });
    const beforePl = buildProfitAndLoss(receipt);
    const afterPl = buildProfitAndLoss([...receipt, ...payment]);
    expect(beforePl.operatingExpensesKgs).toBe('0.00');
    expect(afterPl.operatingExpensesKgs).toBe('0.00');
    expect(beforePl.cogsKgs).toBe('0.00');
    expect(afterPl.cogsKgs).toBe('0.00');
    expect(beforePl.netProfitKgs).toBe(afterPl.netProfitKgs);
  });

  it('12. ДДС shows supplier payment outflow on paidAt date', () => {
    const opening = journal(DAY1, [
      { accountCode: ACCOUNT_CODE.CASH, debitKgs: '2000000.00', creditKgs: '0.00' },
      {
        accountCode: ACCOUNT_CODE.INVESTOR_CAPITAL,
        debitKgs: '0.00',
        creditKgs: '2000000.00',
      },
    ] as ReturnType<typeof buildSupplierApPaymentLines>, 'OPENING_BALANCE');
    const receipt = journal(
      DAY2,
      receiptWithSupplierDebt('100000') as ReturnType<typeof buildSupplierApPaymentLines>,
      'PURCHASE_RECEIPT',
    );
    const payment = journal(DAY3, buildSupplierApPaymentLines({ amountKgs: '40000' }));
    const ddsBefore = buildCashFlowStatement({
      journals: [opening, receipt],
      from: DAY3,
      to: DAY3,
    });
    expect(ddsBefore.supplierPaymentsKgs).toBe('0.00');
    const ddsAfter = buildCashFlowStatement({
      journals: [opening, receipt, payment],
      from: DAY3,
      to: DAY3,
    });
    expect(ddsAfter.supplierPaymentsKgs).toBe('40000.00');
    expect(classifyJournalCashFlow(payment).supplierPaymentsKgs).toBe('40000.00');
  });

  it('13. balance sheet stays balanced after supplier payment', () => {
    const opening = [
      { accountCode: ACCOUNT_CODE.CASH, debitKgs: '2000000.00', creditKgs: '0.00' },
      {
        accountCode: ACCOUNT_CODE.INVESTOR_CAPITAL,
        debitKgs: '0.00',
        creditKgs: '2000000.00',
      },
    ];
    const receipt = receiptWithSupplierDebt('100000');
    const payment = buildSupplierApPaymentLines({ amountKgs: '40000' });
    const posted = [...opening, ...receipt, ...payment];
    const sheet = buildBalanceSheet(posted);
    expect(sheet.liabilities.supplierApKgs).toBe('60000.00');
    expect(sheet.assets.cashKgs).toBe('1960000.00');
    expect(sheet.differenceKgs).toBe('0.00');
  });

  it('14. journal lines are balanced for partial and full supplier payments', () => {
    for (const amount of ['40000', '60000']) {
      const totals = validateJournalLines(buildSupplierApPaymentLines({ amountKgs: amount }));
      expect(totals.debitKgs.eq(totals.creditKgs)).toBe(true);
    }
  });

  it('15. shared SupplierPaymentModal is used from Debts and Purchase pages', () => {
    const fs = require('fs');
    const path = require('path');
    const debtsPage = fs.readFileSync(
      path.join(__dirname, '../../../web/src/app/(app)/finance/debts/page.tsx'),
      'utf8',
    );
    const purchasePage = fs.readFileSync(
      path.join(__dirname, '../../../web/src/app/(app)/purchases/[id]/page.tsx'),
      'utf8',
    );
    expect(debtsPage).toContain('SupplierPaymentModal');
    expect(purchasePage).toContain('SupplierPaymentModal');
    expect(debtsPage).toContain('supplierPaymentTargetFromPayable');
    expect(purchasePage).toContain('supplierPaymentTargetFromPurchase');
  });
});
