import { ACCOUNT_CODE, OPENING_INVESTOR_CAPITAL_KGS } from './accounting-codes';
import {
  buildCargoPayableLines,
  buildCargoPaymentLines,
  buildCashPurchaseLines,
  buildCashSaleLines,
  buildCreditPurchaseLines,
  buildCreditSaleLines,
  buildDebtCollectionLines,
  buildOpeningInvestorCapitalLines,
  buildOperatingExpenseLines,
  buildOwnerSalaryLines,
  buildOwnerWithdrawalLines,
  buildPartialPurchaseLines,
  buildPurchaseReceiptLines,
  buildSaleLines,
  buildSupplierApPaymentLines,
  creditNormalBalance,
  debitNormalBalance,
  payableStatusFromAmounts,
  reconcileSubledgerToGl,
  remainingPayableAmount,
  reverseJournalLines,
  saleCogsFromItems,
  validateJournalLines,
  UnbalancedJournalError,
  InvalidJournalLineError,
} from './accounting-journal.logic';
import { moneyStr, roundMoney } from '../purchases/purchase-calc';

function totals(lines: ReturnType<typeof validateJournalLines> extends never ? never : Parameters<typeof validateJournalLines>[0]) {
  return validateJournalLines(lines);
}

describe('accounting journal foundation', () => {
  it('1. posts opening investor capital as Dr Cash / Cr Investor Capital', () => {
    const lines = buildOpeningInvestorCapitalLines();
    const { debitKgs, creditKgs } = totals(lines);
    expect(moneyStr(debitKgs)).toBe(OPENING_INVESTOR_CAPITAL_KGS);
    expect(moneyStr(creditKgs)).toBe(OPENING_INVESTOR_CAPITAL_KGS);
    expect(debitNormalBalance(lines, ACCOUNT_CODE.CASH).toFixed(2)).toBe(
      OPENING_INVESTOR_CAPITAL_KGS,
    );
    expect(creditNormalBalance(lines, ACCOUNT_CODE.INVESTOR_CAPITAL).toFixed(2)).toBe(
      OPENING_INVESTOR_CAPITAL_KGS,
    );
    expect(lines.every((row) => row.accountCode !== undefined)).toBe(true);
    expect(JSON.stringify(lines)).not.toContain('Cash');
    expect(JSON.stringify(lines)).not.toContain('Investor Capital');
  });

  it('2. cash purchase: Dr Inventory / Cr Cash', () => {
    const lines = buildCashPurchaseLines('15000.00');
    totals(lines);
    expect(debitNormalBalance(lines, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('15000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.CASH).toFixed(2)).toBe('15000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('0.00');
  });

  it('3. credit purchase: Dr Inventory / Cr Supplier AP', () => {
    const lines = buildCreditPurchaseLines('22000.50');
    totals(lines);
    expect(debitNormalBalance(lines, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('22000.50');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('22000.50');
  });

  it('4. partial purchase: Dr Inventory / Cr Cash / Cr Supplier AP', () => {
    const lines = buildPartialPurchaseLines({ inventoryKgs: '10000', paidKgs: '4000' });
    const { debitKgs, creditKgs } = totals(lines);
    expect(moneyStr(debitKgs)).toBe('10000.00');
    expect(moneyStr(creditKgs)).toBe('10000.00');
    expect(debitNormalBalance(lines, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('10000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.CASH).toFixed(2)).toBe('4000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('6000.00');
    expect(payableStatusFromAmounts('10000', '4000')).toBe('PARTIAL');
  });

  it('4b. paid-at-receipt purchase: Dr Inventory / Cr Cash / Cr Supplier AP / Cr Cargo AP', () => {
    const lines = buildPurchaseReceiptLines({
      inventoryKgs: '500000',
      cargoKgs: '100000',
      paidSupplierKgs: '300000',
    });
    const { debitKgs, creditKgs } = totals(lines);
    expect(moneyStr(debitKgs)).toBe(moneyStr(creditKgs));
    expect(debitNormalBalance(lines, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('500000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.CASH).toFixed(2)).toBe('300000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('100000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe('100000.00');
  });

  it('5. unpaid cargo is capitalized into inventory and credited to cargo AP', () => {
    const receipt = buildPurchaseReceiptLines({
      inventoryKgs: '18000.00',
      cargoKgs: '3000.00',
    });
    totals(receipt);
    expect(debitNormalBalance(receipt, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('18000.00');
    expect(creditNormalBalance(receipt, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('15000.00');
    expect(creditNormalBalance(receipt, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe('3000.00');

    const cargoOnly = buildCargoPayableLines('3000.00');
    totals(cargoOnly);
    expect(debitNormalBalance(cargoOnly, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('3000.00');
    expect(creditNormalBalance(cargoOnly, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe('3000.00');
  });

  it('6. cargo payment: Dr Cargo AP / Cr Cash without double-counting inventory', () => {
    const recognize = buildPurchaseReceiptLines({
      inventoryKgs: '18000.00',
      cargoKgs: '3000.00',
    });
    const pay = buildCargoPaymentLines({ amountKgs: '3000.00' });
    totals(pay);
    const posted = [...recognize, ...pay];
    expect(debitNormalBalance(posted, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('18000.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe('0.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.CASH).toFixed(2)).toBe('3000.00');
  });

  it('7. cash sale: Dr Cash / Cr Revenue and Dr COGS / Cr Inventory using WAC snapshot', () => {
    const cogs = saleCogsFromItems([{ quantity: '2', unitCostKgs: '6000.0000' }]);
    expect(cogs.toFixed(2)).toBe('12000.00');
    const lines = buildCashSaleLines({ revenueKgs: '20000', cogsKgs: cogs });
    const { debitKgs, creditKgs } = totals(lines);
    expect(moneyStr(debitKgs)).toBe('32000.00');
    expect(moneyStr(creditKgs)).toBe('32000.00');
    expect(debitNormalBalance(lines, ACCOUNT_CODE.CASH).toFixed(2)).toBe('20000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.SALES_REVENUE).toFixed(2)).toBe('20000.00');
    expect(debitNormalBalance(lines, ACCOUNT_CODE.COGS).toFixed(2)).toBe('12000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('12000.00');
    expect(debitNormalBalance(lines, ACCOUNT_CODE.AR).toFixed(2)).toBe('0.00');
  });

  it('8. credit sale: Dr AR / Cr Revenue and Dr COGS / Cr Inventory', () => {
    const lines = buildCreditSaleLines({ revenueKgs: '10000', cogsKgs: '6000' });
    const { debitKgs, creditKgs } = totals(lines);
    expect(moneyStr(debitKgs)).toBe('16000.00');
    expect(moneyStr(creditKgs)).toBe('16000.00');
    expect(debitNormalBalance(lines, ACCOUNT_CODE.AR).toFixed(2)).toBe('10000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.SALES_REVENUE).toFixed(2)).toBe('10000.00');
    expect(debitNormalBalance(lines, ACCOUNT_CODE.COGS).toFixed(2)).toBe('6000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('6000.00');
  });

  it('9. customer debt payment: Dr Cash / Cr AR', () => {
    const sale = buildCreditSaleLines({ revenueKgs: '10000', cogsKgs: '6000' });
    const collection = buildDebtCollectionLines({ amountKgs: '4000' });
    totals(collection);
    const posted = [...sale, ...collection];
    expect(debitNormalBalance(posted, ACCOUNT_CODE.AR).toFixed(2)).toBe('6000.00');
    expect(debitNormalBalance(posted, ACCOUNT_CODE.CASH).toFixed(2)).toBe('4000.00');
  });

  it('10. warehouse rent: Dr rent expense / Cr Cash', () => {
    const lines = buildOperatingExpenseLines({
      category: 'WAREHOUSE_RENT',
      amountKgs: '25000',
    });
    totals(lines);
    expect(lines[0].accountCode).toBe(ACCOUNT_CODE.WAREHOUSE_RENT);
    expect(debitNormalBalance(lines, ACCOUNT_CODE.WAREHOUSE_RENT).toFixed(2)).toBe('25000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.CASH).toFixed(2)).toBe('25000.00');
  });

  it('11. stationery: Dr stationery expense / Cr Cash', () => {
    const lines = buildOperatingExpenseLines({
      category: 'STATIONERY',
      amountKgs: '150.50',
    });
    totals(lines);
    expect(lines[0].accountCode).toBe(ACCOUNT_CODE.STATIONERY);
    expect(debitNormalBalance(lines, ACCOUNT_CODE.STATIONERY).toFixed(2)).toBe('150.50');
  });

  it('12. owner salary is an operating expense, not drawings', () => {
    const lines = buildOwnerSalaryLines({ amountKgs: '40000' });
    totals(lines);
    expect(lines[0].accountCode).toBe(ACCOUNT_CODE.OWNER_SALARY);
    expect(debitNormalBalance(lines, ACCOUNT_CODE.OWNER_SALARY).toFixed(2)).toBe('40000.00');
    expect(debitNormalBalance(lines, ACCOUNT_CODE.OWNER_DRAWINGS).toFixed(2)).toBe('0.00');
  });

  it('13. owner withdrawal hits drawings equity, not salary expense', () => {
    const lines = buildOwnerWithdrawalLines({ amountKgs: '10000' });
    totals(lines);
    expect(lines[0].accountCode).toBe(ACCOUNT_CODE.OWNER_DRAWINGS);
    expect(debitNormalBalance(lines, ACCOUNT_CODE.OWNER_DRAWINGS).toFixed(2)).toBe('10000.00');
    expect(debitNormalBalance(lines, ACCOUNT_CODE.OWNER_SALARY).toFixed(2)).toBe('0.00');
  });

  it('14. accepts a balanced multi-line sale journal (cash + COGS)', () => {
    const lines = buildSaleLines({
      revenueKgs: '10000',
      paidKgs: '10000',
      cogsKgs: '6000',
    });
    const { debitKgs, creditKgs } = totals(lines);
    expect(debitKgs.eq(creditKgs)).toBe(true);
    expect(moneyStr(debitKgs)).toBe('16000.00');
  });

  it('15. rejects an unbalanced journal', () => {
    expect(() =>
      validateJournalLines([
        { accountCode: ACCOUNT_CODE.CASH, debitKgs: '100.00', creditKgs: '0.00' },
        { accountCode: ACCOUNT_CODE.SALES_REVENUE, debitKgs: '0.00', creditKgs: '90.00' },
      ]),
    ).toThrow(UnbalancedJournalError);

    expect(() =>
      validateJournalLines([
        { accountCode: ACCOUNT_CODE.CASH, debitKgs: '50.00', creditKgs: '10.00' },
      ]),
    ).toThrow(InvalidJournalLineError);

    expect(() => reverseJournalLines(buildOpeningInvestorCapitalLines())).not.toThrow();
    const reversed = reverseJournalLines(buildOpeningInvestorCapitalLines());
    totals(reversed);
    expect(creditNormalBalance(reversed, ACCOUNT_CODE.CASH).toFixed(2)).toBe(
      OPENING_INVESTOR_CAPITAL_KGS,
    );
  });

  it('16. AP remaining amount reconciles to GL supplier AP after partial payment', () => {
    const receipt = buildCreditPurchaseLines('8000');
    const payment = buildSupplierApPaymentLines({ amountKgs: '3000' });
    const posted = [...receipt, ...payment];
    const remaining = remainingPayableAmount('8000', '3000');
    const gl = creditNormalBalance(posted, ACCOUNT_CODE.SUPPLIER_AP);
    expect(payableStatusFromAmounts('8000', '3000')).toBe('PARTIAL');
    expect(remaining.toFixed(2)).toBe('5000.00');
    expect(
      reconcileSubledgerToGl({
        subledgerRemainingKgs: remaining,
        glBalanceKgs: gl,
      }).ok,
    ).toBe(true);
  });

  it('17. AR remaining amount reconciles to GL AR after debt collection', () => {
    const sale = buildSaleLines({ revenueKgs: '12000', paidKgs: '2000', cogsKgs: '7000' });
    const collection = buildDebtCollectionLines({ amountKgs: '3000' });
    const posted = [...sale, ...collection];
    const openDebt = roundMoney(12000 - 2000 - 3000);
    const gl = debitNormalBalance(posted, ACCOUNT_CODE.AR);
    expect(
      reconcileSubledgerToGl({
        subledgerRemainingKgs: openDebt,
        glBalanceKgs: gl,
      }).ok,
    ).toBe(true);
    expect(gl.toFixed(2)).toBe('7000.00');
  });

  it('18. Inventory GL reconciles to operational inventory value for posted movements', () => {
    const receipt = buildPurchaseReceiptLines({
      inventoryKgs: '50000.00',
      cargoKgs: '5000.00',
    });
    const sale = buildCashSaleLines({
      revenueKgs: '18000',
      cogsKgs: saleCogsFromItems([{ quantity: '3', unitCostKgs: '4000' }]),
    });
    const posted = [...receipt, ...sale];
    const inventoryGl = debitNormalBalance(posted, ACCOUNT_CODE.INVENTORY);
    const operationalInventory = roundMoney('50000').minus('12000');
    expect(inventoryGl.toFixed(2)).toBe(operationalInventory.toFixed(2));
    expect(
      reconcileSubledgerToGl({
        subledgerRemainingKgs: operationalInventory,
        glBalanceKgs: inventoryGl,
      }).ok,
    ).toBe(true);
  });

  it('does not treat a zero-amount line or name-hardcoded posting as valid', () => {
    expect(() => buildCashPurchaseLines('0')).toThrow(InvalidJournalLineError);
    expect(() =>
      validateJournalLines([
        { accountCode: '', debitKgs: '1.00', creditKgs: '0.00' },
        { accountCode: ACCOUNT_CODE.CASH, debitKgs: '0.00', creditKgs: '1.00' },
      ]),
    ).toThrow(InvalidJournalLineError);
  });
});
