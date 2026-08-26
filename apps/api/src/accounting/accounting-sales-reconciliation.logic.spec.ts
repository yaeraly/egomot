import {
  HISTORICAL_OPENING_INVENTORY_BLOCKER,
  HISTORICAL_SALES_RECONCILIATION_BLOCKER,
  evaluateBackfillStatus,
  isBackfillApplyAllowed,
  planHistoricalBackfill,
  type BackfillPurchaseInput,
  type BackfillSaleInput,
  type HistoricalBackfillSnapshot,
} from './accounting-backfill.logic';
import {
  LIVE_DB_SALES_CONTROL_DIFFERENCE_KGS,
  LIVE_DB_SALES_REVENUE_KGS,
  SALES_RECONCILIATION_BLOCKER,
  computeSalesControlDifference,
  reconcileHistoricalSales,
} from './accounting-sales-reconciliation.logic';
import {
  FINAL_EXPECTED_TOTAL_AMOUNT_KGS,
  WALK_IN_CUSTOMER_NAME,
  WALK_IN_GROUP_TOKEN,
  groupHistoricalSales,
  resolveHistoricalCustomer,
  resolveHistoricalImportClient,
} from '../sales/historical-sales-import.logic';
import { ACCOUNT_CODE, OPENING_INVESTOR_CAPITAL_KGS, OPERATIONAL_WALLET_STATED_KGS } from './accounting-codes';
import { roundMoney } from '../purchases/purchase-calc';
import Decimal from 'decimal.js';

function posted() {
  return { liveSale: false, revenue: false, cogs: false, debtPaymentIds: [] as string[] };
}

function purchasePosted() {
  return { purchase: false, cargo: false, paymentIds: [] as string[], cargoPaymentIds: [] as string[] };
}

function cashSale(params: {
  id: string;
  amount: string;
  cogs: string;
  date?: string;
}): BackfillSaleInput {
  return {
    id: params.id,
    number: params.id,
    status: 'CONFIRMED',
    totalAmountKgs: params.amount,
    paidAmountKgs: params.amount,
    debtAmountKgs: '0.00',
    saleDate: new Date(params.date ?? '2026-05-14T12:00:00Z'),
    isWalkIn: true,
    items: [{ quantity: '1', unitCostKgs: params.cogs }],
    payments: [
      {
        id: `${params.id}-pay`,
        amountKgs: params.amount,
        paymentMethodCode: 'CASH',
        isDebtCollection: false,
      },
    ],
    alreadyPosted: posted(),
  };
}

function purchase(landed: string, cargo: string): BackfillPurchaseInput {
  return {
    id: 'pur-1',
    number: 'ZG-1',
    status: 'RECEIVED',
    supplierId: 'sup-1',
    estimatedTotalLandedCostKgs: landed,
    totalCargoKgs: cargo,
    purchaseDate: new Date('2026-01-01T00:00:00Z'),
    completedReceipts: [
      {
        id: 'rcpt-1',
        totalLandedCostKgs: landed,
        cargoKgs: cargo,
        alreadyPostedReceipt: false,
      },
    ],
    purchasePayments: [],
    cargoPayments: [],
    alreadyPosted: purchasePosted(),
  };
}

describe('historical sales control-total reconciliation', () => {
  const controlTsvRow =
    '5/14/2026\t0507 535 337\tЖелмаян Контроллер 1,8 кВт 70H\t1.00\t8,160,605.00\n';

  it('1. detects sales control-total mismatch against 1533 / 8,160,605', () => {
    const result = reconcileHistoricalSales({
      tsvContent: controlTsvRow,
      dbLines: [
        {
          saleId: 's1',
          saleNumber: 'S-00001',
          saleDate: new Date('2026-05-14T12:00:00Z'),
          customerName: 'Client',
          customerPhone: '0507 535 337',
          productName: 'Желмаян Контроллер 1,8 кВт 70H',
          quantity: '1',
          unitPriceKgs: '8160605.00',
          lineTotalKgs: '8160605.00',
          idempotencyKey: 'historical-2026-05-14|0507535337',
        },
        {
          saleId: 's2',
          saleNumber: 'S-00002',
          saleDate: new Date('2026-06-01T12:00:00Z'),
          customerName: WALK_IN_CUSTOMER_NAME,
          customerPhone: 'walk-in',
          productName: 'Extra product',
          quantity: '1',
          unitPriceKgs: LIVE_DB_SALES_CONTROL_DIFFERENCE_KGS,
          lineTotalKgs: LIVE_DB_SALES_CONTROL_DIFFERENCE_KGS,
          idempotencyKey: null,
        },
      ],
      dbSaleCount: 261,
      dbRevenueKgs: LIVE_DB_SALES_REVENUE_KGS,
    });
    expect(result.matchesControlTotals).toBe(false);
    expect(result.controlRowCount).toBe(1533);
    expect(result.controlRevenueKgs).toBe('8160605.00');
    expect(result.tsvFileMatchesControlTotals).toBe(false);
  });

  it('2. detects the exact 1,006,610.00 revenue difference', () => {
    expect(computeSalesControlDifference(LIVE_DB_SALES_REVENUE_KGS)).toBe(
      LIVE_DB_SALES_CONTROL_DIFFERENCE_KGS,
    );
    expect(computeSalesControlDifference(FINAL_EXPECTED_TOTAL_AMOUNT_KGS)).toBe('0.00');
    const result = reconcileHistoricalSales({
      tsvContent: controlTsvRow,
      dbLines: [
        {
          saleId: 's2',
          saleNumber: 'S-EXTRA',
          saleDate: new Date('2026-06-01T12:00:00Z'),
          customerName: WALK_IN_CUSTOMER_NAME,
          customerPhone: 'walk-in',
          productName: 'Extra product',
          quantity: '1',
          unitPriceKgs: LIVE_DB_SALES_CONTROL_DIFFERENCE_KGS,
          lineTotalKgs: LIVE_DB_SALES_CONTROL_DIFFERENCE_KGS,
          idempotencyKey: null,
        },
      ],
      dbSaleCount: 1,
      dbRevenueKgs: LIVE_DB_SALES_REVENUE_KGS,
    });
    expect(result.controlDifferenceKgs).toBe(LIVE_DB_SALES_CONTROL_DIFFERENCE_KGS);
    expect(result.mismatchRows.some((row) => row.reason === 'missing import source marker')).toBe(
      true,
    );
    expect(
      result.mismatchRows.find((row) => row.lineTotalKgs === LIVE_DB_SALES_CONTROL_DIFFERENCE_KGS)
        ?.reason,
    ).toBe('missing import source marker');
  });

  it('3. groups sales by phone + date only', () => {
    const tsv = [
      '5/14/2026\t0507 535 337\tProduct A\t1.00\t100.00',
      '5/14/2026\t0507-535-337\tProduct B\t2.00\t50.00',
      '5/15/2026\t0507 535 337\tProduct C\t1.00\t10.00',
    ].join('\n');
    const result = reconcileHistoricalSales({
      tsvContent: tsv,
      dbLines: [],
      dbSaleCount: 0,
      dbRevenueKgs: '0.00',
    });
    expect(result.tsvSaleGroups).toBe(2);
  });

  it('4. maps Розничный to Walk-in Customer', () => {
    expect(resolveHistoricalCustomer('Розничный').kind).toBe('walk-in');
    const client = resolveHistoricalImportClient({
      customerField: 'Розничный',
      knownPhoneDigits: new Set(),
    });
    expect(client.kind).toBe('walk-in');
    if (client.kind === 'walk-in') {
      expect(client.reason).toBe('roznichny');
      expect(client.groupToken).toBe(WALK_IN_GROUP_TOKEN);
    }
  });

  it('5. maps unknown phone to Walk-in Customer after lookup fails', () => {
    const identity = resolveHistoricalCustomer('0704002983');
    expect(identity.kind).toBe('phone');
    const client = resolveHistoricalImportClient({
      customerField: '0704002983',
      knownPhoneDigits: new Set(['0507535337']),
    });
    expect(client.kind).toBe('walk-in');
    if (client.kind === 'walk-in') {
      expect(client.reason).toBe('unknown-phone');
    }
    const known = resolveHistoricalImportClient({
      customerField: '0507 535 337',
      knownPhoneDigits: new Set(['0507535337']),
    });
    expect(known.kind).toBe('phone');
  });

  it('6. detects the historical opening inventory gap of 10,101.80', () => {
    const snapshot: HistoricalBackfillSnapshot = {
      sales: [cashSale({ id: 's', amount: LIVE_DB_SALES_REVENUE_KGS, cogs: '6609212.38' })],
      purchases: [purchase('8501338.88', '1497220.72')],
      operationalInventoryKgs: '1902228.30',
      operationalArKgs: '0.00',
      enforceSalesControlTotals: false,
    };
    const plan = planHistoricalBackfill(snapshot, 'all');
    expect(plan.totals.openingInventoryAdjustmentRequiredKgs).toBe('10101.80');
    expect(evaluateBackfillStatus(plan, 'all').status).toBe(HISTORICAL_OPENING_INVENTORY_BLOCKER);
  });

  it('7. does not create an automatic opening inventory plug', () => {
    const plan = planHistoricalBackfill(
      {
        sales: [cashSale({ id: 's', amount: '10000.00', cogs: '6000.00' })],
        purchases: [purchase('20000.00', '3000.00')],
        operationalInventoryKgs: '1902228.30',
        enforceSalesControlTotals: false,
      },
      'all',
    );
    expect(plan.planned.some((row) => row.memo?.toLowerCase().includes('opening inventory'))).toBe(
      false,
    );
    expect(plan.planned.some((row) => row.sourceType === 'OPENING_BALANCE')).toBe(false);
    expect(evaluateBackfillStatus(plan, 'all').status).toBe(HISTORICAL_OPENING_INVENTORY_BLOCKER);
    expect(isBackfillApplyAllowed(evaluateBackfillStatus(plan, 'all'), false)).toBe(false);
  });

  it('8. does not invent a fake cash adjustment', () => {
    const plan = planHistoricalBackfill(
      {
        sales: [cashSale({ id: 's', amount: LIVE_DB_SALES_REVENUE_KGS, cogs: '6609212.38' })],
        purchases: [purchase('8501338.88', '1497220.72')],
        openingCapitalPostedKgs: OPENING_INVESTOR_CAPITAL_KGS,
        operationalWalletComputedKgs: OPERATIONAL_WALLET_STATED_KGS,
        operationalInventoryKgs: '1902228.30',
        enforceSalesControlTotals: true,
      },
      'all',
    );
    const cashCredits = plan.planned.flatMap((row) => row.lines).filter((line) =>
      roundMoney(line.creditKgs).gt(0) &&
      (line.accountCode === ACCOUNT_CODE.CASH || line.accountCode === ACCOUNT_CODE.BANK),
    );
    expect(cashCredits).toHaveLength(0);
    expect(plan.totals.openingVsWalletGapKgs).toBe('-6582503.00');
    expect(plan.totals.verifiedCashOutKgs).toBe('0.00');
  });

  it('9. blocks backfill when sales or inventory reconciliation is unresolved', () => {
    const snapshot: HistoricalBackfillSnapshot = {
      sales: [cashSale({ id: 's', amount: LIVE_DB_SALES_REVENUE_KGS, cogs: '6609212.38' })],
      purchases: [purchase('8501338.88', '1497220.72')],
      operationalInventoryKgs: '1902228.30',
      operationalArKgs: '0.00',
      enforceSalesControlTotals: true,
      salesReconciliation: reconcileHistoricalSales({
        tsvContent: controlTsvRow,
        dbLines: [
          {
            saleId: 's2',
            saleNumber: 'S-EXTRA',
            saleDate: new Date('2026-06-01T12:00:00Z'),
            customerName: WALK_IN_CUSTOMER_NAME,
            customerPhone: 'walk-in',
            productName: 'Extra product',
            quantity: '1',
            unitPriceKgs: LIVE_DB_SALES_CONTROL_DIFFERENCE_KGS,
            lineTotalKgs: LIVE_DB_SALES_CONTROL_DIFFERENCE_KGS,
            idempotencyKey: null,
          },
        ],
        dbSaleCount: 261,
        dbRevenueKgs: LIVE_DB_SALES_REVENUE_KGS,
      }),
    };
    const plan = planHistoricalBackfill(snapshot, 'all');
    const evaluation = evaluateBackfillStatus(plan, 'all');
    expect(evaluation.status).toBe(HISTORICAL_SALES_RECONCILIATION_BLOCKER);
    expect(evaluation.status).toBe(SALES_RECONCILIATION_BLOCKER);
    expect(evaluation.blockers.some((row) => row.includes('10101.80'))).toBe(true);
    expect(isBackfillApplyAllowed(evaluation, false)).toBe(false);
    expect(isBackfillApplyAllowed(evaluation, true)).toBe(false);
    expect(plan.totals.salesControlDifferenceKgs).toBe(LIVE_DB_SALES_CONTROL_DIFFERENCE_KGS);
  });

  it('groups phone+date independently of Walk-in client fallback', () => {
    const groups = groupHistoricalSales([
      {
        lineNumber: 1,
        sourceRowId: 'a',
        saleDate: new Date('2026-05-14T12:00:00Z'),
        phone: '0704002983',
        phoneDigits: '0704002983',
        isWalkIn: false,
        productName: 'A',
        quantity: new Decimal(1),
        unitPriceKgs: new Decimal(10),
        lineTotalKgs: new Decimal(10),
      },
    ]);
    expect(groups[0].key).toContain('0704002983');
    expect(groups[0].isWalkIn).toBe(false);
  });
});
