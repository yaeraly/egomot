import { ACCOUNT_CODE } from './accounting-codes';
import {
  buildCargoPaymentLines,
  buildPurchaseReceiptLines,
  buildSupplierApPaymentLines,
  buildTransportPaymentLines,
  creditNormalBalance,
  debitNormalBalance,
  validateJournalLines,
} from './accounting-journal.logic';
import { buildBalanceSheet, buildProfitAndLoss, classifyJournalCashFlow } from './accounting-reports.logic';
import { buildLogisticsApPaymentLines, buildLogisticsCostLines } from './logistics-cost.logic';
import {
  buildApReclassLines,
  planApReclassMove,
  splitPurchaseLandedCost,
  unpaidPurchaseObligations,
} from './payable-classification.logic';
import {
  aggregateCargoApByPurchase,
  aggregateSupplierApByPurchase,
  aggregateTransportApByPurchaseAndType,
  sumRemaining,
  type JournalApInput,
  type PurchaseIdLookup,
} from './payable-sync.logic';
import { moneyStr } from '../purchases/purchase-calc';

const PURCHASE_ID = 'purchase-1';
const DAY = new Date('2026-06-01T00:00:00.000Z');

function lookup(): PurchaseIdLookup {
  return {
    receipts: new Map([['receipt-1', PURCHASE_ID]]),
    purchasePayments: new Map([['sup-pay', PURCHASE_ID]]),
    cargoPayments: new Map([['cargo-pay', PURCHASE_ID]]),
    logisticsExpenses: new Map([
      ['china-exp', PURCHASE_ID],
      ['cargo-exp', PURCHASE_ID],
      ['kg-exp', PURCHASE_ID],
    ]),
    logisticsPayments: new Map([
      ['china-pay', PURCHASE_ID],
      ['kg-pay', PURCHASE_ID],
    ]),
    purchaseIds: new Set([PURCHASE_ID]),
  };
}

function journal(
  sourceType: string,
  sourceId: string,
  lines: ReturnType<typeof buildPurchaseReceiptLines>,
): JournalApInput {
  validateJournalLines(lines);
  return { id: sourceId, sourceType, sourceId, postedAt: DAY, lines };
}

describe('supplier AP excludes logistics; cargo/transport AP stay separate', () => {
  const unpaidReceipt = buildPurchaseReceiptLines({
    goodsKgs: '1000000',
    chinaTransportKgs: '50000',
    cargoKgs: '100000',
    kyrgyzstanTransportKgs: '30000',
  });

  it('1-5. unpaid purchase: 2000=goods, 2010=cargo, 2020=china+kg, inventory=landed', () => {
    validateJournalLines(unpaidReceipt);
    expect(debitNormalBalance(unpaidReceipt, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('1180000.00');
    expect(creditNormalBalance(unpaidReceipt, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('1000000.00');
    expect(creditNormalBalance(unpaidReceipt, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe('100000.00');
    expect(creditNormalBalance(unpaidReceipt, ACCOUNT_CODE.TRANSPORT_AP).toFixed(2)).toBe('80000.00');
    expect(creditNormalBalance(unpaidReceipt, ACCOUNT_CODE.CASH).toFixed(2)).toBe('0.00');

    const ids = lookup();
    const posted = [journal('PURCHASE_RECEIPT', 'receipt-1', unpaidReceipt)];
    expect(sumRemaining(aggregateSupplierApByPurchase(posted, ids))).toBe('1000000.00');
    expect(sumRemaining(aggregateCargoApByPurchase(posted, ids))).toBe('100000.00');
    expect(sumRemaining(aggregateTransportApByPurchaseAndType(posted, ids))).toBe('80000.00');
  });

  it('6-8. partial payments reduce only their own AP', () => {
    const supplierPay = buildSupplierApPaymentLines({ amountKgs: '700000' });
    const cargoPay = buildCargoPaymentLines({ amountKgs: '60000' });
    const posted = [
      ...unpaidReceipt,
      ...supplierPay,
      ...cargoPay,
    ];
    expect(creditNormalBalance(posted, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('300000.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe('40000.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.TRANSPORT_AP).toFixed(2)).toBe('80000.00');
    expect(debitNormalBalance(posted, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('1180000.00');

    const chinaPay = buildTransportPaymentLines({ amountKgs: '20000' });
    const afterChina = [...posted, ...chinaPay];
    expect(creditNormalBalance(afterChina, ACCOUNT_CODE.TRANSPORT_AP).toFixed(2)).toBe('60000.00');
    expect(creditNormalBalance(afterChina, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('300000.00');
    expect(creditNormalBalance(afterChina, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe('40000.00');
  });

  it('9-10. inventory landed cost unchanged and balance sheet stays balanced after payments', () => {
    const opening = [
      { accountCode: ACCOUNT_CODE.CASH, debitKgs: '2000000.00', creditKgs: '0.00' },
      { accountCode: ACCOUNT_CODE.INVESTOR_CAPITAL, debitKgs: '0.00', creditKgs: '2000000.00' },
    ];
    const supplierPay = buildSupplierApPaymentLines({ amountKgs: '700000' });
    const cargoPay = buildCargoPaymentLines({ amountKgs: '60000' });
    const before = [...opening, ...unpaidReceipt];
    const after = [...before, ...supplierPay, ...cargoPay];
    const sheetBefore = buildBalanceSheet(before);
    const sheetAfter = buildBalanceSheet(after);
    expect(sheetAfter.assets.inventoryKgs).toBe(sheetBefore.assets.inventoryKgs);
    expect(sheetAfter.assets.inventoryKgs).toBe('1180000.00');
    expect(sheetAfter.liabilities.supplierApKgs).toBe('300000.00');
    expect(sheetAfter.liabilities.cargoApKgs).toBe('40000.00');
    expect(sheetAfter.liabilities.transportApKgs).toBe('80000.00');
    expect(sheetAfter.liabilities.totalLiabilitiesKgs).toBe('420000.00');
    expect(sheetAfter.differenceKgs).toBe('0.00');
    expect(sheetBefore.differenceKgs).toBe('0.00');
  });

  it('11. ДДС payment categories stay on the matching AP account', () => {
    const supplier = classifyJournalCashFlow(
      journal('PURCHASE_PAYMENT', 'sup-pay', buildSupplierApPaymentLines({ amountKgs: '700000' })),
    );
    const cargo = classifyJournalCashFlow(
      journal('CARGO_PAYMENT', 'cargo-pay', buildCargoPaymentLines({ amountKgs: '60000' })),
    );
    const china = classifyJournalCashFlow(
      journal(
        'LOGISTICS_CHINA_PAYMENT',
        'china-pay',
        buildLogisticsApPaymentLines({
          amountKgs: '20000',
          payableAccountCode: ACCOUNT_CODE.TRANSPORT_AP,
        }),
      ),
    );
    const kg = classifyJournalCashFlow(
      journal(
        'LOGISTICS_KYRGYZSTAN_PAYMENT',
        'kg-pay',
        buildTransportPaymentLines({ amountKgs: '10000' }),
      ),
    );
    expect(supplier.supplierPaymentsKgs).toBe('700000.00');
    expect(supplier.cargoPaymentsKgs).toBe('0.00');
    expect(cargo.cargoPaymentsKgs).toBe('60000.00');
    expect(cargo.supplierPaymentsKgs).toBe('0.00');
    expect(china.chinaTransportPaymentsKgs).toBe('20000.00');
    expect(kg.kyrgyzstanTransportPaymentsKgs).toBe('10000.00');
  });

  it('12. ОПУ is unaffected by payable repayment', () => {
    const pay = [
      ...unpaidReceipt,
      ...buildSupplierApPaymentLines({ amountKgs: '700000' }),
      ...buildCargoPaymentLines({ amountKgs: '60000' }),
      ...buildTransportPaymentLines({ amountKgs: '30000' }),
    ];
    const pl = buildProfitAndLoss(pay);
    expect(pl.operatingExpensesKgs).toBe('0.00');
    expect(pl.cogsKgs).toBe('0.00');
    expect(pl.salesRevenueKgs).toBe('0.00');
  });

  it('live goods receipt plus unpaid logistics journals do not mix AP owners', () => {
    const goods = buildPurchaseReceiptLines({ goodsKgs: '1000000' });
    const china = buildLogisticsCostLines({
      amountKgs: '50000',
      payableAccountCode: ACCOUNT_CODE.TRANSPORT_AP,
    });
    const cargo = buildLogisticsCostLines({
      amountKgs: '100000',
      payableAccountCode: ACCOUNT_CODE.CARGO_AP,
    });
    const kg = buildLogisticsCostLines({
      amountKgs: '30000',
      payableAccountCode: ACCOUNT_CODE.TRANSPORT_AP,
    });
    const posted = [...goods, ...china, ...cargo, ...kg];
    expect(debitNormalBalance(posted, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('1180000.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('1000000.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe('100000.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.TRANSPORT_AP).toFixed(2)).toBe('80000.00');
  });

  it('reclass moves mixed Supplier AP onto cargo/transport without touching inventory', () => {
    const mixed = buildPurchaseReceiptLines({
      inventoryKgs: '1180000',
      cargoKgs: '100000',
    });
    expect(creditNormalBalance(mixed, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('1080000.00');
    const move = planApReclassMove({
      supplierRemainingKgs: '1080000',
      cargoRemainingKgs: '100000',
      chinaRemainingKgs: '0',
      kyrgyzstanRemainingKgs: '0',
      supplierTargetUnpaidKgs: '1000000',
      cargoTargetUnpaidKgs: '100000',
      chinaTargetUnpaidKgs: '50000',
      kyrgyzstanTargetUnpaidKgs: '30000',
    });
    expect(moneyStr(move.cargoKgs)).toBe('0.00');
    expect(moneyStr(move.chinaKgs)).toBe('50000.00');
    expect(moneyStr(move.kyrgyzstanKgs)).toBe('30000.00');
    const reclass = buildApReclassLines({
      fromSupplierKgs: '80000',
      toChinaKgs: '50000',
      toKyrgyzstanKgs: '30000',
    });
    const posted = [...mixed, ...reclass];
    expect(debitNormalBalance(posted, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('1180000.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('1000000.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe('100000.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.TRANSPORT_AP).toFixed(2)).toBe('80000.00');
    const sheet = buildBalanceSheet(posted);
    expect(sheet.differenceKgs).toBe('0.00');
  });

  it('unpaidPurchaseObligations matches the partial-payment example', () => {
    const split = splitPurchaseLandedCost({
      goodsKgs: '1000000',
      chinaTransportKgs: '50000',
      cargoKgs: '100000',
      kyrgyzstanTransportKgs: '30000',
    });
    expect(moneyStr(split.supplierKgs)).toBe('1000000.00');
    expect(moneyStr(split.transportKgs)).toBe('80000.00');
    const unpaid = unpaidPurchaseObligations({
      goodsKgs: '1000000',
      chinaTransportKgs: '50000',
      cargoKgs: '100000',
      kyrgyzstanTransportKgs: '30000',
      goodsPaidKgs: '700000',
      cargoPaidKgs: '60000',
    });
    expect(moneyStr(unpaid.supplierUnpaidKgs)).toBe('300000.00');
    expect(moneyStr(unpaid.cargoUnpaidKgs)).toBe('40000.00');
    expect(moneyStr(unpaid.transportUnpaidKgs)).toBe('80000.00');
    expect(moneyStr(unpaid.totalUnpaidKgs)).toBe('420000.00');
  });
});
