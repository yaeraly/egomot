import { ACCOUNT_CODE } from './accounting-codes';
import {
  buildPurchaseReceiptLines,
  buildSupplierApPaymentLines,
  creditNormalBalance,
  debitNormalBalance,
  payableStatusFromAmounts,
  remainingPayableAmount,
  validateJournalLines,
} from './accounting-journal.logic';
import { buildBalanceSheet, buildProfitAndLoss } from './accounting-reports.logic';
import { buildLogisticsCostLines } from './logistics-cost.logic';
import {
  computeGoodsSupplierPayable,
  isPurchaseReceivedForSupplierAp,
  NO_SUPPLIER_DEBT_MESSAGE,
  PAYMENT_AMOUNT_MUST_BE_POSITIVE_MESSAGE,
  PAYMENT_EXCEEDS_REMAINING_MESSAGE,
  purchaseAndFinanceSupplierDebtMatch,
  purchaseIdFromGoodsApSource,
  settlementFromSupplierPayables,
  shouldBackfillSupplierPayable,
  shouldRepairZeroedSupplierPayable,
  sumVerifiedSupplierPaidKgs,
} from './goods-supplier-payable.logic';
import { moneyStr } from '../purchases/purchase-calc';

describe('goods-only SupplierPayable is the single supplier debt source', () => {
  const goods = '100000.00';
  const china = '8000.00';
  const cargo = '15000.00';
  const kg = '5000.00';

  it('1. existing purchase with SupplierPayable uses that remaining, not landed cost', () => {
    const settlement = settlementFromSupplierPayables([
      { paidAmountKgs: '0', remainingAmountKgs: '100000' },
    ]);
    expect(settlement.supplierUnpaidAmountKgs).toBe('100000.00');
    expect(settlement.supplierPaidAmountKgs).toBe('0.00');
    expect(settlement.supplierPayableStatus).toBe('UNPAID');
  });

  it('2. received purchase missing payable but verified goods debt exists is backfilled', () => {
    const paid = sumVerifiedSupplierPaidKgs({
      purchasePaymentKgs: [],
      paidAtReceiptKgs: '0',
    });
    const amounts = computeGoodsSupplierPayable({
      goodsKgs: goods,
      verifiedSupplierPaidKgs: paid,
      chinaTransportKgs: china,
      cargoKgs: cargo,
      kyrgyzstanTransportKgs: kg,
    });
    expect(
      shouldBackfillSupplierPayable({
        existingCount: 0,
        received: isPurchaseReceivedForSupplierAp('RECEIVED', true),
        remainingAmountKgs: amounts.remainingAmountKgs,
      }),
    ).toBe(true);
    expect(moneyStr(amounts.amountKgs)).toBe(goods);
    expect(moneyStr(amounts.remainingAmountKgs)).toBe(goods);
  });

  it('3. backfill uses goods minus verified supplier payments, not landed cost', () => {
    const paid = sumVerifiedSupplierPaidKgs({
      purchasePaymentKgs: ['25000'],
      paidAtReceiptKgs: '15000',
    });
    const amounts = computeGoodsSupplierPayable({
      goodsKgs: goods,
      verifiedSupplierPaidKgs: paid,
      chinaTransportKgs: china,
      cargoKgs: cargo,
      kyrgyzstanTransportKgs: kg,
    });
    expect(moneyStr(amounts.amountKgs)).toBe('100000.00');
    expect(moneyStr(amounts.paidAmountKgs)).toBe('40000.00');
    expect(moneyStr(amounts.remainingAmountKgs)).toBe('60000.00');
    expect(amounts.status).toBe('PARTIAL');
    expect(shouldRepairZeroedSupplierPayable({
      existingRemainingKgs: '0',
      goodsRemainingKgs: amounts.remainingAmountKgs,
    })).toBe(true);
  });

  it('4. does not backfill a second SupplierPayable when one already exists', () => {
    expect(
      shouldBackfillSupplierPayable({
        existingCount: 1,
        received: true,
        remainingAmountKgs: '100000',
      }),
    ).toBe(false);
  });

  it('5. Supplier AP excludes cargo', () => {
    const amounts = computeGoodsSupplierPayable({
      goodsKgs: goods,
      verifiedSupplierPaidKgs: '0',
      cargoKgs: cargo,
    });
    expect(moneyStr(amounts.remainingAmountKgs)).toBe(goods);
    const receipt = buildPurchaseReceiptLines({
      goodsKgs: goods,
      cargoKgs: cargo,
    });
    expect(creditNormalBalance(receipt, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe(goods);
    expect(creditNormalBalance(receipt, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe(cargo);
  });

  it('6. Supplier AP excludes China internal transport', () => {
    const amounts = computeGoodsSupplierPayable({
      goodsKgs: goods,
      verifiedSupplierPaidKgs: '0',
      chinaTransportKgs: china,
    });
    expect(moneyStr(amounts.remainingAmountKgs)).toBe(goods);
    const chinaJournal = buildLogisticsCostLines({
      amountKgs: china,
      payableAccountCode: ACCOUNT_CODE.TRANSPORT_AP,
    });
    expect(creditNormalBalance(chinaJournal, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('0.00');
    expect(creditNormalBalance(chinaJournal, ACCOUNT_CODE.TRANSPORT_AP).toFixed(2)).toBe(china);
  });

  it('7. Supplier AP excludes Kyrgyzstan internal transport', () => {
    const amounts = computeGoodsSupplierPayable({
      goodsKgs: goods,
      verifiedSupplierPaidKgs: '0',
      kyrgyzstanTransportKgs: kg,
    });
    expect(moneyStr(amounts.remainingAmountKgs)).toBe(goods);
    const kgJournal = buildLogisticsCostLines({
      amountKgs: kg,
      payableAccountCode: ACCOUNT_CODE.TRANSPORT_AP,
    });
    expect(creditNormalBalance(kgJournal, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('0.00');
  });

  it('8. partial payment 40,000 of 100,000 leaves 60,000 PARTIAL', () => {
    const after = computeGoodsSupplierPayable({
      goodsKgs: goods,
      verifiedSupplierPaidKgs: '40000',
    });
    expect(after.status).toBe('PARTIAL');
    expect(moneyStr(after.paidAmountKgs)).toBe('40000.00');
    expect(moneyStr(after.remainingAmountKgs)).toBe('60000.00');
    expect(payableStatusFromAmounts('100000', '40000')).toBe('PARTIAL');
  });

  it('9. full payment clears remaining and status is PAID', () => {
    const after = computeGoodsSupplierPayable({
      goodsKgs: goods,
      verifiedSupplierPaidKgs: goods,
    });
    expect(after.status).toBe('PAID');
    expect(moneyStr(after.remainingAmountKgs)).toBe('0.00');
    expect(remainingPayableAmount(goods, goods).toFixed(2)).toBe('0.00');
  });

  it('10. purchase page and finance debt page show the same SupplierPayable remaining', () => {
    const payable = { paidAmountKgs: '40000', remainingAmountKgs: '60000' };
    const purchase = settlementFromSupplierPayables([payable]);
    expect(
      purchaseAndFinanceSupplierDebtMatch({
        purchaseRemainingKgs: purchase.supplierUnpaidAmountKgs,
        financeRemainingKgs: payable.remainingAmountKgs,
      }),
    ).toBe(true);
    const missing = settlementFromSupplierPayables([]);
    expect(missing.supplierUnpaidAmountKgs).toBe('0.00');
  });

  it('11. cash decreases by the supplier payment, not by logistics', () => {
    const opening = [
      { accountCode: ACCOUNT_CODE.CASH, debitKgs: '2000000.00', creditKgs: '0.00' },
      { accountCode: ACCOUNT_CODE.INVESTOR_CAPITAL, debitKgs: '0.00', creditKgs: '2000000.00' },
    ];
    const receipt = buildPurchaseReceiptLines({
      goodsKgs: goods,
      chinaTransportKgs: china,
      cargoKgs: cargo,
      kyrgyzstanTransportKgs: kg,
    });
    const payment = buildSupplierApPaymentLines({ amountKgs: '40000' });
    const posted = [...opening, ...receipt, ...payment];
    expect(debitNormalBalance(posted, ACCOUNT_CODE.CASH).toFixed(2)).toBe('1960000.00');
  });

  it('12. inventory is unchanged by supplier debt repayment', () => {
    const receipt = buildPurchaseReceiptLines({
      goodsKgs: goods,
      chinaTransportKgs: china,
      cargoKgs: cargo,
      kyrgyzstanTransportKgs: kg,
    });
    const payment = buildSupplierApPaymentLines({ amountKgs: '40000' });
    expect(debitNormalBalance(receipt, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe(
      debitNormalBalance([...receipt, ...payment], ACCOUNT_CODE.INVENTORY).toFixed(2),
    );
    expect(debitNormalBalance(receipt, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('128000.00');
  });

  it('13. balance sheet stays balanced after partial and full supplier payment', () => {
    const opening = [
      { accountCode: ACCOUNT_CODE.CASH, debitKgs: '2000000.00', creditKgs: '0.00' },
      { accountCode: ACCOUNT_CODE.INVESTOR_CAPITAL, debitKgs: '0.00', creditKgs: '2000000.00' },
    ];
    const receipt = buildPurchaseReceiptLines({ goodsKgs: goods });
    const partial = buildSupplierApPaymentLines({ amountKgs: '40000' });
    const full = buildSupplierApPaymentLines({ amountKgs: '60000' });
    expect(buildBalanceSheet([...opening, ...receipt, ...partial]).differenceKgs).toBe('0.00');
    expect(buildBalanceSheet([...opening, ...receipt, ...partial, ...full]).differenceKgs).toBe(
      '0.00',
    );
    expect(buildProfitAndLoss([...receipt, ...partial, ...full]).operatingExpensesKgs).toBe('0.00');
    expect(validateJournalLines(partial).debitKgs.eq(validateJournalLines(partial).creditKgs)).toBe(
      true,
    );
  });

  it('14. Russian error messages stay on the payment API contract', () => {
    expect(NO_SUPPLIER_DEBT_MESSAGE).toBe(
      'Нет долга поставщику по этой закупке. Обновите страницу «Долги».',
    );
    expect(PAYMENT_EXCEEDS_REMAINING_MESSAGE).toBe('Сумма оплаты не может превышать остаток долга');
    expect(PAYMENT_AMOUNT_MUST_BE_POSITIVE_MESSAGE).toBe('Сумма оплаты должна быть больше 0');
    expect(purchaseIdFromGoodsApSource('goods-ap:purchase-1')).toBe('purchase-1');
  });

  it('does not invent debt for a draft purchase with no payable', () => {
    expect(
      shouldBackfillSupplierPayable({
        existingCount: 0,
        received: isPurchaseReceivedForSupplierAp('DRAFT', false),
        remainingAmountKgs: goods,
      }),
    ).toBe(false);
  });
});
