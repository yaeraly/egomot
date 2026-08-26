import {
  OPENING_INVESTOR_CAPITAL_KGS,
  OPERATIONAL_WALLET_STATED_KGS,
} from './accounting-codes';
import {
  evaluateBackfillStatus,
  formatHistoricalBackfillReport,
  planHistoricalBackfill,
  parseBackfillArgs,
  purchaseRecognitionAmounts,
  verifiedSupplierPaymentTotal,
  type BackfillPurchaseInput,
  type BackfillSaleInput,
  type HistoricalBackfillSnapshot,
} from './accounting-backfill.logic';
import { ACCOUNT_CODE } from './accounting-codes';
import { debitNormalBalance, creditNormalBalance, validateJournalLines } from './accounting-journal.logic';
import { moneyStr, roundMoney } from '../purchases/purchase-calc';

function posted() {
  return {
    liveSale: false,
    revenue: false,
    cogs: false,
    debtPaymentIds: [] as string[],
  };
}

function purchasePosted() {
  return {
    purchase: false,
    cargo: false,
    paymentIds: [] as string[],
    cargoPaymentIds: [] as string[],
  };
}

function walkInCashSale(): BackfillSaleInput {
  return {
    id: 'sale-walk-in',
    number: 'S-00001',
    status: 'CONFIRMED',
    totalAmountKgs: '10000.00',
    paidAmountKgs: '10000.00',
    debtAmountKgs: '0.00',
    saleDate: new Date('2026-01-10T00:00:00Z'),
    isWalkIn: true,
    items: [{ quantity: '2', unitCostKgs: '3000' }],
    payments: [
      {
        id: 'pay-1',
        amountKgs: '10000.00',
        paymentMethodCode: 'CASH',
        isDebtCollection: false,
      },
    ],
    alreadyPosted: posted(),
  };
}

function creditSale(): BackfillSaleInput {
  return {
    id: 'sale-credit',
    number: 'S-00002',
    status: 'CONFIRMED',
    totalAmountKgs: '8000.00',
    paidAmountKgs: '0.00',
    debtAmountKgs: '8000.00',
    saleDate: new Date('2026-01-11T00:00:00Z'),
    isWalkIn: false,
    items: [{ quantity: '1', unitCostKgs: '5000' }],
    payments: [],
    alreadyPosted: posted(),
  };
}

function unpaidPurchase(status: string): BackfillPurchaseInput {
  return {
    id: 'pur-1',
    number: 'ZG-2026-0001',
    status,
    supplierId: 'sup-1',
    estimatedTotalLandedCostKgs: '20000.00',
    totalCargoKgs: '3000.00',
    purchaseDate: new Date('2026-01-01T00:00:00Z'),
    completedReceipts: [
      {
        id: 'rcpt-1',
        totalLandedCostKgs: '20000.00',
        cargoKgs: '3000.00',
        alreadyPostedReceipt: false,
      },
    ],
    purchasePayments: [],
    cargoPayments: [],
    alreadyPosted: purchasePosted(),
  };
}

describe('historical finance backfill', () => {
  it('does not invent supplier cash out when Purchase.status=PAID without payment documents', () => {
    const purchase = unpaidPurchase('PAID');
    expect(verifiedSupplierPaymentTotal(purchase).toFixed(2)).toBe('0.00');
    const plan = planHistoricalBackfill(
      { sales: [], purchases: [purchase], operationalInventoryKgs: '20000.00' },
      'all',
    );
    expect(plan.planned.some((row) => row.sourceType === 'PURCHASE_PAYMENT')).toBe(false);
    expect(plan.totals.verifiedSupplierPaymentsKgs).toBe('0.00');
    expect(plan.totals.supplierApKgs).toBe('17000.00');
    expect(plan.totals.verifiedCashOutKgs).toBe('0.00');
    expect(plan.totals.inventedPaymentAttempts).toBe(1);
  });

  it('keeps walk-in completed cash sales off AR', () => {
    const plan = planHistoricalBackfill(
      {
        sales: [walkInCashSale()],
        purchases: [],
        operationalArKgs: '0.00',
        operationalInventoryKgs: '0.00',
      },
      'sales',
    );
    const revenue = plan.planned.find((row) => row.sourceType === 'SALE_REVENUE')!;
    expect(debitNormalBalance(revenue.lines, ACCOUNT_CODE.AR).toFixed(2)).toBe('0.00');
    expect(debitNormalBalance(revenue.lines, ACCOUNT_CODE.CASH).toFixed(2)).toBe('10000.00');
    expect(plan.totals.creditSalesKgs).toBe('0.00');
  });

  it('books credit sales to AR and uses SaleItem.unitCostKgs for COGS', () => {
    const plan = planHistoricalBackfill(
      { sales: [creditSale()], purchases: [], operationalInventoryKgs: '0.00' },
      'sales',
    );
    const revenue = plan.planned.find((row) => row.sourceType === 'SALE_REVENUE')!;
    const cogs = plan.planned.find((row) => row.sourceType === 'SALE_COGS')!;
    expect(debitNormalBalance(revenue.lines, ACCOUNT_CODE.AR).toFixed(2)).toBe('8000.00');
    expect(debitNormalBalance(cogs.lines, ACCOUNT_CODE.COGS).toFixed(2)).toBe('5000.00');
    expect(creditNormalBalance(cogs.lines, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('5000.00');
    expect(plan.totals.cogsKgs).toBe('5000.00');
  });

  it('posts verified debt collections only when a payment document exists', () => {
    const sale: BackfillSaleInput = {
      ...creditSale(),
      debtAmountKgs: '3000.00',
      payments: [
        {
          id: 'col-1',
          amountKgs: '5000.00',
          paymentMethodCode: 'CASH',
          isDebtCollection: true,
        },
      ],
    };
    const plan = planHistoricalBackfill({ sales: [sale], purchases: [] }, 'payments');
    expect(plan.planned).toHaveLength(1);
    expect(plan.planned[0].sourceType).toBe('SALE_DEBT_PAYMENT');
    expect(debitNormalBalance(plan.planned[0].lines, ACCOUNT_CODE.CASH).toFixed(2)).toBe('5000.00');
  });

  it('capitalizes unpaid cargo into inventory and cargo AP without assuming it was paid', () => {
    const plan = planHistoricalBackfill(
      { sales: [], purchases: [unpaidPurchase('RECEIVED')] },
      'cargo',
    );
    expect(plan.planned).toHaveLength(1);
    expect(plan.planned[0].sourceType).toBe('CARGO');
    expect(plan.totals.cargoApKgs).toBe('3000.00');
    expect(plan.totals.verifiedCargoPaymentsKgs).toBe('0.00');
  });

  it('splits purchase landed cost into supplier AP and cargo without double-counting', () => {
    const purchase = unpaidPurchase('RECEIVED');
    const amounts = purchaseRecognitionAmounts(purchase);
    expect(amounts.supplier.toFixed(2)).toBe('17000.00');
    expect(amounts.cargo.toFixed(2)).toBe('3000.00');
    expect(amounts.landed.toFixed(2)).toBe('20000.00');
    const plan = planHistoricalBackfill({ sales: [], purchases: [purchase] }, 'all');
    const inv = debitNormalBalance(
      plan.planned.flatMap((row) => row.lines),
      ACCOUNT_CODE.INVENTORY,
    );
    expect(inv.toFixed(2)).toBe('20000.00');
  });

  it('is idempotent: already posted journals are skipped', () => {
    const sale = walkInCashSale();
    sale.alreadyPosted = { ...posted(), revenue: true, cogs: true };
    const purchase = unpaidPurchase('PAID');
    purchase.alreadyPosted = { ...purchasePosted(), purchase: true, cargo: true };
    const plan = planHistoricalBackfill({ sales: [sale], purchases: [purchase] }, 'all');
    expect(plan.planned).toHaveLength(0);
    expect(plan.skipped.length).toBeGreaterThan(0);
  });

  it('does not create opening capital and does not plug cash to the operational wallet', () => {
    const snapshot: HistoricalBackfillSnapshot = {
      sales: [walkInCashSale()],
      purchases: [unpaidPurchase('RECEIVED')],
      openingCapitalPostedKgs: OPENING_INVESTOR_CAPITAL_KGS,
      operationalWalletComputedKgs: OPERATIONAL_WALLET_STATED_KGS,
      operationalInventoryKgs: '14000.00',
      operationalArKgs: '0.00',
    };
    const plan = planHistoricalBackfill(snapshot, 'all');
    expect(plan.planned.some((row) => row.sourceType.startsWith('OPENING'))).toBe(false);
    expect(plan.totals.openingInvestorCapitalKgs).toBe(OPENING_INVESTOR_CAPITAL_KGS);
    expect(plan.totals.operationalWalletStatedKgs).toBe(OPERATIONAL_WALLET_STATED_KGS);
    expect(plan.totals.accountingCashKgs).not.toBe(OPERATIONAL_WALLET_STATED_KGS);
    expect(plan.totals.verifiedCashOutKgs).toBe('0.00');
    const expectedCash = roundMoney(OPENING_INVESTOR_CAPITAL_KGS).plus(10000);
    expect(plan.totals.accountingCashKgs).toBe(moneyStr(expectedCash));
    expect(plan.totals.cashReconciliationGapKgs).not.toBe('0.00');
  });

  it('reconciles purchases minus COGS to inventory movement', () => {
    const snapshot: HistoricalBackfillSnapshot = {
      sales: [walkInCashSale(), creditSale()],
      purchases: [unpaidPurchase('RECEIVED')],
      operationalInventoryKgs: '9000.00',
      operationalArKgs: '8000.00',
    };
    const plan = planHistoricalBackfill(snapshot, 'all');
    const lines = plan.planned.flatMap((row) => row.lines);
    const inventory = debitNormalBalance(lines, ACCOUNT_CODE.INVENTORY);
    expect(inventory.toFixed(2)).toBe('9000.00');
    expect(plan.totals.cogsKgs).toBe('11000.00');
    expect(plan.totals.glInventoryKgs).toBe('9000.00');
    expect(plan.totals.inventoryDifferenceKgs).toBe('0.00');
    expect(evaluateBackfillStatus(plan, 'all').status).toBe('PASS');
  });

  it('rejects unbalanced planned journals', () => {
    expect(() =>
      validateJournalLines([
        { accountCode: ACCOUNT_CODE.INVENTORY, debitKgs: '10.00', creditKgs: '0.00' },
        { accountCode: ACCOUNT_CODE.SUPPLIER_AP, debitKgs: '0.00', creditKgs: '9.00' },
      ]),
    ).toThrow(/unbalanced/i);
  });

  it('dry-run report includes required totals without needing a database', () => {
    const plan = planHistoricalBackfill(
      {
        sales: [walkInCashSale()],
        purchases: [unpaidPurchase('RECEIVED')],
        operationalInventoryKgs: '14000.00',
        operationalArKgs: '0.00',
      },
      'all',
    );
    const report = formatHistoricalBackfillReport(plan, 'all');
    expect(report).toContain('=== HISTORICAL FINANCE BACKFILL ===');
    expect(report).toContain('Opening investor capital:');
    expect(report).toContain(OPENING_INVESTOR_CAPITAL_KGS);
    expect(report).toContain('Operational wallet total:');
    expect(report).toContain(OPERATIONAL_WALLET_STATED_KGS);
    expect(report).toContain('Cash reconciliation gap:');
  });

  it('parses CLI flags without posting', () => {
    expect(parseBackfillArgs(['--dry-run']).dryRun).toBe(true);
    expect(parseBackfillArgs(['--sales']).mode).toBe('sales');
    expect(parseBackfillArgs(['--all']).mode).toBe('all');
    expect(parseBackfillArgs([]).mode).toBe('all');
  });
});
