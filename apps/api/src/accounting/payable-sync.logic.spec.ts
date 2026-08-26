import { ACCOUNT_CODE } from './accounting-codes';
import {
  buildPurchaseReceiptLines,
  buildSupplierApPaymentLines,
  creditNormalBalance,
  validateJournalLines,
} from './accounting-journal.logic';
import { buildBalanceSheet, buildFinanceDashboard, type PostedReportJournal } from './accounting-reports.logic';
import { buildLogisticsApPaymentLines, buildLogisticsCostLines } from './logistics-cost.logic';
import {
  aggregateCargoApByPurchase,
  aggregateSupplierApByPurchase,
  aggregateTransportApByPurchaseAndType,
  DEFAULT_PAYABLE_LIST_FILTER,
  filterPayables,
  isOpenPayable,
  resolveJournalPurchaseId,
  sumRemaining,
  type JournalApInput,
  type PurchaseIdLookup,
} from './payable-sync.logic';

const DAY1 = new Date('2026-01-01T00:00:00.000Z');
const DAY2 = new Date('2026-01-10T00:00:00.000Z');

const PURCHASE_A = 'purchase-a';
const PURCHASE_B = 'purchase-b';
const RECEIPT_A = 'receipt-a';
const RECEIPT_B = 'receipt-b';

function journal(
  id: string,
  postedAt: Date,
  sourceType: string,
  sourceId: string,
  lines: ReturnType<typeof buildCreditPurchaseLines>,
): JournalApInput & PostedReportJournal {
  validateJournalLines(lines);
  return {
    id,
    postedAt,
    sourceType,
    sourceId,
    status: 'POSTED',
    lines,
  };
}

function lookup(): PurchaseIdLookup {
  return {
    receipts: new Map([
      [RECEIPT_A, PURCHASE_A],
      [RECEIPT_B, PURCHASE_B],
    ]),
    purchasePayments: new Map(),
    cargoPayments: new Map(),
    logisticsExpenses: new Map(),
    logisticsPayments: new Map(),
    purchaseIds: new Set([PURCHASE_A, PURCHASE_B]),
  };
}

describe('payable ledger sync vs finance dashboard', () => {
  const receiptA = journal(
    'j1',
    DAY1,
    'PURCHASE_RECEIPT',
    RECEIPT_A,
    buildPurchaseReceiptLines({
      inventoryKgs: '500000.00',
      cargoKgs: '100000.00',
      paidSupplierKgs: '0',
    }),
  );
  const receiptB = journal(
    'j2',
    DAY1,
    'PURCHASE_RECEIPT',
    RECEIPT_B,
    buildPurchaseReceiptLines({
      inventoryKgs: '414369.80',
      cargoKgs: '55579.80',
      paidSupplierKgs: '0',
    }),
  );
  const journals = [receiptA, receiptB];

  it('1. supplier debt list returns current payables from GL receipts', () => {
    const rows = aggregateSupplierApByPurchase(journals, lookup());
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => isOpenPayable(row.remainingKgs))).toBe(true);
  });

  it('2. supplier detail total equals finance dashboard Supplier AP 758,790.00', () => {
    const rows = aggregateSupplierApByPurchase(journals, lookup());
    const dash = buildFinanceDashboard({
      journals,
      from: DAY1,
      to: new Date('2026-12-31T23:59:59.999Z'),
    });
    expect(sumRemaining(rows)).toBe('758790.00');
    expect(dash.supplierDebtKgs).toBe('758790.00');
    expect(sumRemaining(rows)).toBe(dash.supplierDebtKgs);
    expect(buildBalanceSheet(journals.flatMap((row) => row.lines)).liabilities.supplierApKgs).toBe(
      '758790.00',
    );
  });

  it('3. cargo debt list returns current payables from GL receipts', () => {
    const rows = aggregateCargoApByPurchase(journals, lookup());
    expect(rows).toHaveLength(2);
    expect(creditNormalBalance(journals.flatMap((j) => j.lines), ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe(
      '155579.80',
    );
  });

  it('4. cargo detail total equals finance dashboard Cargo AP 155,579.80', () => {
    const rows = aggregateCargoApByPurchase(journals, lookup());
    const dash = buildFinanceDashboard({
      journals,
      from: DAY1,
      to: new Date('2026-12-31T23:59:59.999Z'),
    });
    expect(sumRemaining(rows)).toBe('155579.80');
    expect(dash.cargoDebtKgs).toBe('155579.80');
    expect(sumRemaining(rows)).toBe(dash.cargoDebtKgs);
  });

  it('5. transport debt list is grouped by China / Kyrgyzstan type', () => {
    const china = buildLogisticsCostLines({
      amountKgs: '20000',
      payableAccountCode: ACCOUNT_CODE.TRANSPORT_AP,
    });
    const kg = buildLogisticsCostLines({
      amountKgs: '8000',
      payableAccountCode: ACCOUNT_CODE.TRANSPORT_AP,
    });
    const transportJournals: JournalApInput[] = [
      journal('t1', DAY1, 'LOGISTICS_CHINA', 'exp-china', china),
      journal('t2', DAY1, 'LOGISTICS_KYRGYZSTAN', 'exp-kg', kg),
    ];
    const ids: PurchaseIdLookup = {
      ...lookup(),
      logisticsExpenses: new Map([
        ['exp-china', PURCHASE_A],
        ['exp-kg', PURCHASE_A],
      ]),
    };
    const rows = aggregateTransportApByPurchaseAndType(transportJournals, ids);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.type === 'CHINA_INTERNAL_TRANSPORT')?.remainingKgs.toFixed(2)).toBe(
      '20000.00',
    );
    expect(
      rows.find((row) => row.type === 'KYRGYZSTAN_INTERNAL_TRANSPORT')?.remainingKgs.toFixed(2),
    ).toBe('8000.00');
  });

  it('6. partial supplier payment keeps remaining visible as OPEN', () => {
    const payment = journal(
      'p1',
      DAY2,
      'PURCHASE_PAYMENT',
      'pay-1',
      buildSupplierApPaymentLines({ amountKgs: '40000' }),
    );
    const ids: PurchaseIdLookup = {
      ...lookup(),
      purchasePayments: new Map([['pay-1', PURCHASE_A]]),
    };
    const rows = aggregateSupplierApByPurchase([receiptA, payment], ids);
    const row = rows.find((item) => item.purchaseId === PURCHASE_A)!;
    expect(row.status).toBe('PARTIAL');
    expect(row.paidKgs.toFixed(2)).toBe('40000.00');
    expect(row.remainingKgs.toFixed(2)).toBe('360000.00');
    expect(filterPayables(
      [{ status: row.status, remainingAmountKgs: row.remainingKgs }],
      DEFAULT_PAYABLE_LIST_FILTER,
    )).toHaveLength(1);
  });

  it('7. full supplier payment clears remaining and leaves OPEN filter', () => {
    const payment = journal(
      'p2',
      DAY2,
      'PURCHASE_PAYMENT',
      'pay-2',
      buildSupplierApPaymentLines({ amountKgs: '400000' }),
    );
    const ids: PurchaseIdLookup = {
      ...lookup(),
      purchasePayments: new Map([['pay-2', PURCHASE_A]]),
    };
    const rows = aggregateSupplierApByPurchase([receiptA, payment], ids);
    const row = rows.find((item) => item.purchaseId === PURCHASE_A)!;
    expect(row.status).toBe('PAID');
    expect(row.remainingKgs.toFixed(2)).toBe('0.00');
    expect(filterPayables(
      [{ status: row.status, remainingAmountKgs: row.remainingKgs }],
      'OPEN',
    )).toHaveLength(0);
    expect(filterPayables(
      [{ status: row.status, remainingAmountKgs: row.remainingKgs }],
      'PAID',
    )).toHaveLength(1);
  });

  it('8. partial cargo payment reduces cargo AP only', () => {
    const paymentLines = buildLogisticsApPaymentLines({
      amountKgs: '40000',
      payableAccountCode: ACCOUNT_CODE.CARGO_AP,
    });
    const payment = journal('cp1', DAY2, 'CARGO_PAYMENT', 'cpay-1', paymentLines);
    const ids: PurchaseIdLookup = {
      ...lookup(),
      cargoPayments: new Map([['cpay-1', PURCHASE_A]]),
    };
    const rows = aggregateCargoApByPurchase([receiptA, payment], ids);
    const row = rows.find((item) => item.purchaseId === PURCHASE_A)!;
    expect(row.remainingKgs.toFixed(2)).toBe('60000.00');
    expect(row.status).toBe('PARTIAL');
  });

  it('9. full cargo payment settles cargo AP', () => {
    const paymentLines = buildLogisticsApPaymentLines({
      amountKgs: '100000',
      payableAccountCode: ACCOUNT_CODE.CARGO_AP,
    });
    const payment = journal('cp2', DAY2, 'CARGO_PAYMENT', 'cpay-2', paymentLines);
    const ids: PurchaseIdLookup = {
      ...lookup(),
      cargoPayments: new Map([['cpay-2', PURCHASE_A]]),
    };
    const rows = aggregateCargoApByPurchase([receiptA, payment], ids);
    expect(rows.find((item) => item.purchaseId === PURCHASE_A)?.remainingKgs.toFixed(2)).toBe('0.00');
  });

  it('10. transport payment reduces 2020 and not 2010', () => {
    const recognize = journal(
      't3',
      DAY1,
      'LOGISTICS_CHINA',
      'exp-1',
      buildLogisticsCostLines({
        amountKgs: '20000',
        payableAccountCode: ACCOUNT_CODE.TRANSPORT_AP,
      }),
    );
    const pay = journal(
      't4',
      DAY2,
      'LOGISTICS_CHINA_PAYMENT',
      'tpay-1',
      buildLogisticsApPaymentLines({
        amountKgs: '5000',
        payableAccountCode: ACCOUNT_CODE.TRANSPORT_AP,
      }),
    );
    const ids: PurchaseIdLookup = {
      ...lookup(),
      logisticsExpenses: new Map([['exp-1', PURCHASE_A]]),
      logisticsPayments: new Map([['tpay-1', PURCHASE_A]]),
    };
    const rows = aggregateTransportApByPurchaseAndType([recognize, pay], ids);
    expect(rows[0].remainingKgs.toFixed(2)).toBe('15000.00');
    expect(aggregateCargoApByPurchase([recognize, pay], ids).every((row) => row.remainingKgs.eq(0))).toBe(
      true,
    );
  });

  it('11-16. payment journal: cash down, AP down, inventory/ОПУ unchanged, balanced', () => {
    const opening = [
      { accountCode: ACCOUNT_CODE.CASH, debitKgs: '2000000.00', creditKgs: '0.00' },
      { accountCode: ACCOUNT_CODE.INVESTOR_CAPITAL, debitKgs: '0.00', creditKgs: '2000000.00' },
    ];
    const receipt = buildPurchaseReceiptLines({ inventoryKgs: '100000', cargoKgs: '0' });
    const payment = buildSupplierApPaymentLines({ amountKgs: '40000' });
    const before = [...opening, ...receipt];
    const after = [...before, ...payment];
    const sheetBefore = buildBalanceSheet(before);
    const sheetAfter = buildBalanceSheet(after);
    expect(sheetAfter.assets.cashKgs).toBe('1960000.00');
    expect(sheetAfter.liabilities.supplierApKgs).toBe('60000.00');
    expect(sheetAfter.assets.inventoryKgs).toBe(sheetBefore.assets.inventoryKgs);
    expect(sheetAfter.differenceKgs).toBe('0.00');
    const dash = buildFinanceDashboard({
      journals: [
        { postedAt: DAY1, sourceType: 'OPENING_BALANCE', status: 'POSTED', lines: opening },
        { postedAt: DAY1, sourceType: 'PURCHASE_RECEIPT', status: 'POSTED', lines: receipt },
        { postedAt: DAY2, sourceType: 'PURCHASE_PAYMENT', status: 'POSTED', lines: payment },
      ],
      from: DAY2,
      to: DAY2,
    });
    expect(dash.operatingExpensesKgs).toBe('0.00');
    expect(dash.cogsKgs).toBe('0.00');
  });

  it('17. default OPEN filter does not hide remaining > 0 even if status is UNPAID', () => {
    const rows = [
      { status: 'UNPAID', remainingAmountKgs: '758790.00' },
      { status: 'PARTIAL', remainingAmountKgs: '155579.80' },
      { status: 'PAID', remainingAmountKgs: '0.00' },
    ];
    const open = filterPayables(rows, DEFAULT_PAYABLE_LIST_FILTER);
    expect(open).toHaveLength(2);
    expect(open.some((row) => row.remainingAmountKgs === '758790.00')).toBe(true);
  });

  it('18. Russian status labels stay on the debts UI contract', () => {
    const fs = require('fs');
    const path = require('path');
    const page = fs.readFileSync(
      path.join(__dirname, '../../../web/src/app/(app)/finance/debts/page.tsx'),
      'utf8',
    );
    expect(page).toContain('Поставщики');
    expect(page).toContain('Карго');
    expect(page).toContain('Транспорт');
    expect(page).toContain('Оплатить');
    expect(page).toContain('Не оплачено');
    expect(page).toContain('Частично оплачено');
    expect(page).toContain('Оплачено');
  });

  it('resolves PURCHASE_RECEIPT sourceId through receipt lookup, not purchase.status', () => {
    expect(
      resolveJournalPurchaseId(
        { id: 'x', sourceType: 'PURCHASE_RECEIPT', sourceId: RECEIPT_A, postedAt: DAY1, lines: [] },
        lookup(),
      ),
    ).toBe(PURCHASE_A);
  });
});
