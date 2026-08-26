import {
  ACCOUNT_CODE,
  OPENING_INVESTOR_CAPITAL_KGS,
  OPENING_INVESTOR_CAPITAL_POSTED_ON,
  OPERATIONAL_WALLET_STATED_KGS,
  openingInvestorCapitalPostedAt,
} from './accounting-codes';
import {
  buildCargoPayableLines,
  buildCashSaleLines,
  line,
  buildOpeningInvestorCapitalLines,
  buildOperatingExpenseLines,
  buildOwnerSalaryLines,
  buildOwnerWithdrawalLines,
  buildPartialPurchaseLines,
  buildPurchaseReceiptLines,
  creditNormalBalance,
  debitNormalBalance,
  reverseJournalLines,
  validateJournalLines,
} from './accounting-journal.logic';
import {
  buildLogisticsApPaymentLines,
  buildLogisticsCostLines,
} from './logistics-cost.logic';
import {
  buildBalanceSheet,
  buildCashFlowStatement,
  buildFinanceDashboard,
  buildProfitAndLoss,
  classifyJournalCashFlow,
  flattenJournalLines,
  linesOnOrBefore,
  type PostedReportJournal,
} from './accounting-reports.logic';
import { moneyStr } from '../purchases/purchase-calc';

const DAY1 = new Date('2026-01-01T00:00:00.000Z');
const DAY2 = new Date('2026-01-02T00:00:00.000Z');
const DAY3 = new Date('2026-01-03T00:00:00.000Z');
const DAY4 = new Date('2026-01-04T00:00:00.000Z');

function journal(
  postedAt: Date,
  lines: ReturnType<typeof buildOpeningInvestorCapitalLines>,
  sourceType?: string,
): PostedReportJournal {
  validateJournalLines(lines);
  return { postedAt, sourceType, status: 'POSTED', lines };
}

function validationScenario() {
  const opening = journal(DAY1, buildOpeningInvestorCapitalLines(), 'OPENING_BALANCE');
  const purchase = journal(
    DAY2,
    buildPartialPurchaseLines({ inventoryKgs: '1000000', paidKgs: '700000' }),
    'PURCHASE_RECEIPT',
  );
  const cargo = journal(DAY2, buildCargoPayableLines('100000'), 'CARGO');
  const sale = journal(
    DAY3,
    buildCashSaleLines({ revenueKgs: '500000', cogsKgs: '300000' }),
    'SALE',
  );
  return { opening, purchase, cargo, sale, journals: [opening, purchase, cargo, sale] };
}

describe('clean accounting rebuild validation scenario', () => {
  it('posts investor capital 2,584,712 to company cash', () => {
    const { opening } = validationScenario();
    expect(debitNormalBalance(opening.lines, ACCOUNT_CODE.CASH).toFixed(2)).toBe(
      OPENING_INVESTOR_CAPITAL_KGS,
    );
    expect(creditNormalBalance(opening.lines, ACCOUNT_CODE.INVESTOR_CAPITAL).toFixed(2)).toBe(
      OPENING_INVESTOR_CAPITAL_KGS,
    );
  });

  it('purchase A: inventory 1,000,000 paid 700,000 remaining AP 300,000', () => {
    const { opening, purchase } = validationScenario();
    const posted = [...opening.lines, ...purchase.lines];
    expect(debitNormalBalance(posted, ACCOUNT_CODE.CASH).toFixed(2)).toBe('1884712.00');
    expect(debitNormalBalance(posted, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('1000000.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('300000.00');
  });

  it('unpaid cargo 100,000 capitalizes into inventory and cargo AP', () => {
    const { opening, purchase, cargo } = validationScenario();
    const posted = [...opening.lines, ...purchase.lines, ...cargo.lines];
    expect(debitNormalBalance(posted, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('1100000.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe('100000.00');
  });

  it('cash sale: revenue 500,000 COGS 300,000 gross profit 200,000', () => {
    const { journals } = validationScenario();
    const posted = journals.flatMap((row) => row.lines);
    expect(debitNormalBalance(posted, ACCOUNT_CODE.CASH).toFixed(2)).toBe('2384712.00');
    expect(debitNormalBalance(posted, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('800000.00');
    const pl = buildProfitAndLoss(posted);
    expect(pl.salesRevenueKgs).toBe('500000.00');
    expect(pl.cogsKgs).toBe('300000.00');
    expect(pl.grossProfitKgs).toBe('200000.00');
  });

  it('balance sheet equation difference is 0.00 with no plug', () => {
    const { journals } = validationScenario();
    const sheet = buildBalanceSheet(journals.flatMap((row) => row.lines));
    expect(sheet.assets.cashKgs).toBe('2384712.00');
    expect(sheet.assets.inventoryKgs).toBe('800000.00');
    expect(sheet.liabilities.supplierApKgs).toBe('300000.00');
    expect(sheet.liabilities.cargoApKgs).toBe('100000.00');
    expect(sheet.equity.investorCapitalKgs).toBe(OPENING_INVESTOR_CAPITAL_KGS);
    expect(sheet.equity.retainedEarningsKgs).toBe('200000.00');
    expect(sheet.assets.totalAssetsKgs).toBe(sheet.liabilitiesPlusEquityKgs);
    expect(sheet.differenceKgs).toBe('0.00');
  });

  it('ДДС closing cash reconciles to GL cash and excludes inventory purchases as opex', () => {
    const { journals } = validationScenario();
    const dds = buildCashFlowStatement({
      journals,
      from: DAY1,
      to: new Date('2026-01-31T23:59:59.999Z'),
    });
    expect(dds.openingCashKgs).toBe('0.00');
    expect(dds.investorContributionsKgs).toBe(OPENING_INVESTOR_CAPITAL_KGS);
    expect(dds.supplierPaymentsKgs).toBe('700000.00');
    expect(dds.cashSalesKgs).toBe('500000.00');
    expect(dds.closingCashKgs).toBe('2384712.00');
    expect(dds.glClosingCashKgs).toBe('2384712.00');
    expect(dds.differenceKgs).toBe('0.00');
    expect(dds.cargoPaymentsKgs).toBe('0.00');
  });

  it('ОПУ does not expense inventory purchase, AP payment, or capitalized cargo', () => {
    const { journals } = validationScenario();
    const pl = buildProfitAndLoss(journals.flatMap((row) => row.lines));
    expect(pl.cogsKgs).toBe('300000.00');
    expect(pl.operatingExpensesKgs).toBe('0.00');
    expect(pl.netProfitKgs).toBe('200000.00');
  });

  it('owner salary reduces profit; owner withdrawal does not', () => {
    const { journals } = validationScenario();
    const salary = journal(
      DAY4,
      buildOwnerSalaryLines({ amountKgs: '20000' }),
      'OPERATING_EXPENSE',
    );
    const withdrawal = journal(
      DAY4,
      buildOwnerWithdrawalLines({ amountKgs: '15000' }),
      'OWNER_WITHDRAWAL',
    );
    const posted = [...journals, salary, withdrawal].flatMap((row) => row.lines);
    const pl = buildProfitAndLoss(posted);
    expect(pl.ownerSalaryKgs).toBe('20000.00');
    expect(pl.netProfitKgs).toBe('180000.00');
    const sheet = buildBalanceSheet(posted);
    expect(sheet.equity.ownerDrawingsKgs).toBe('15000.00');
    expect(sheet.differenceKgs).toBe('0.00');
    expect(debitNormalBalance(posted, ACCOUNT_CODE.CASH).toFixed(2)).toBe('2349712.00');
  });

  it('warehouse rent and stationery are operating cash outflows', () => {
    const rent = journal(
      DAY4,
      buildOperatingExpenseLines({ category: 'WAREHOUSE_RENT', amountKgs: '10000' }),
    );
    const stationery = journal(
      DAY4,
      buildOperatingExpenseLines({ category: 'STATIONERY', amountKgs: '500' }),
    );
    expect(classifyJournalCashFlow(rent).warehouseRentKgs).toBe('10000.00');
    expect(classifyJournalCashFlow(stationery).stationeryKgs).toBe('500.00');
    const pl = buildProfitAndLoss([...rent.lines, ...stationery.lines]);
    expect(pl.operatingExpensesKgs).toBe('10500.00');
  });

  it('reversal journal nets the original document to zero in the ledger', () => {
    const sale = journal(DAY3, buildCashSaleLines({ revenueKgs: '500000', cogsKgs: '300000' }));
    const reversal = journal(DAY4, reverseJournalLines(sale.lines), 'REVERSAL');
    const posted = [...sale.lines, ...reversal.lines];
    expect(debitNormalBalance(posted, ACCOUNT_CODE.CASH).toFixed(2)).toBe('0.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.SALES_REVENUE).toFixed(2)).toBe('0.00');
    expect(debitNormalBalance(posted, ACCOUNT_CODE.COGS).toFixed(2)).toBe('0.00');
    expect(debitNormalBalance(posted, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('0.00');
    expect(moneyStr(validateJournalLines(reversal.lines).debitKgs)).toBe(
      moneyStr(validateJournalLines(sale.lines).debitKgs),
    );
  });

  it('cash/credit/partial receipt postings stay balanced and paid-at-receipt credits cash', () => {
    const cash = buildPurchaseReceiptLines({
      inventoryKgs: '500000',
      cargoKgs: '0',
      paidSupplierKgs: '500000',
    });
    const credit = buildPurchaseReceiptLines({ inventoryKgs: '500000', cargoKgs: '0' });
    const partial = buildPurchaseReceiptLines({
      inventoryKgs: '500000',
      cargoKgs: '0',
      paidSupplierKgs: '300000',
    });
    const withCargo = buildPurchaseReceiptLines({
      inventoryKgs: '500000',
      cargoKgs: '100000',
      paidSupplierKgs: '300000',
    });
    for (const lines of [cash, credit, partial, withCargo]) {
      const totals = validateJournalLines(lines);
      expect(totals.debitKgs.eq(totals.creditKgs)).toBe(true);
    }
    expect(creditNormalBalance(cash, ACCOUNT_CODE.CASH).toFixed(2)).toBe('500000.00');
    expect(creditNormalBalance(credit, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('500000.00');
    expect(creditNormalBalance(partial, ACCOUNT_CODE.CASH).toFixed(2)).toBe('300000.00');
    expect(creditNormalBalance(partial, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('200000.00');
    expect(debitNormalBalance(withCargo, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('500000.00');
    expect(creditNormalBalance(withCargo, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe('100000.00');
    expect(creditNormalBalance(withCargo, ACCOUNT_CODE.CASH).toFixed(2)).toBe('300000.00');
    expect(creditNormalBalance(withCargo, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('100000.00');
  });

  it('finance dashboard reads company cash from the ledger, not sale payment sums', () => {
    const { journals } = validationScenario();
    const dashboard = buildFinanceDashboard({
      journals,
      from: DAY1,
      to: new Date('2026-01-31T23:59:59.999Z'),
    });
    expect(dashboard.companyCashKgs).toBe('2384712.00');
    expect(dashboard.inventoryValueKgs).toBe('800000.00');
    expect(dashboard.supplierDebtKgs).toBe('300000.00');
    expect(dashboard.cargoDebtKgs).toBe('100000.00');
    expect(dashboard.salesRevenueKgs).toBe('500000.00');
    expect(dashboard.grossProfitKgs).toBe('200000.00');
    expect(dashboard.netProfitKgs).toBe('200000.00');
    expect(dashboard.balanceDifferenceKgs).toBe('0.00');
    expect(dashboard.companyCashKgs).not.toBe('9167215.00');
    expect(dashboard.companyCashKgs).not.toBe(OPERATIONAL_WALLET_STATED_KGS);
    expect(dashboard.investorCapitalKgs).toBe(OPENING_INVESTOR_CAPITAL_KGS);
    expect(dashboard.cogsKgs).toBe('300000.00');
  });

  it('owner dashboard reads GL cash, bank 1010, and investor capital 3000 from opening journal only', () => {
    const opening = journal(DAY1, buildOpeningInvestorCapitalLines(), 'OPENING_BALANCE');
    const dashboard = buildFinanceDashboard({
      journals: [opening],
      from: DAY1,
      to: new Date('2026-01-31T23:59:59.999Z'),
    });
    const sheet = buildBalanceSheet(opening.lines);

    expect(dashboard.companyCashKgs).toBe(OPENING_INVESTOR_CAPITAL_KGS);
    expect(dashboard.companyBankKgs).toBe('0.00');
    expect(dashboard.investorCapitalKgs).toBe(OPENING_INVESTOR_CAPITAL_KGS);
    expect(dashboard.accountsReceivableKgs).toBe('0.00');
    expect(dashboard.supplierDebtKgs).toBe('0.00');
    expect(dashboard.cargoDebtKgs).toBe('0.00');
    expect(dashboard.inventoryValueKgs).toBe('0.00');
    expect(dashboard.salesRevenueKgs).toBe('0.00');
    expect(dashboard.cogsKgs).toBe('0.00');
    expect(dashboard.grossProfitKgs).toBe('0.00');
    expect(dashboard.operatingExpensesKgs).toBe('0.00');
    expect(dashboard.netProfitKgs).toBe('0.00');
    expect(dashboard.balanceDifferenceKgs).toBe('0.00');
    expect(dashboard.companyCashKgs).not.toBe(OPERATIONAL_WALLET_STATED_KGS);
    expect(sheet.assets.cashKgs).toBe(OPENING_INVESTOR_CAPITAL_KGS);
    expect(sheet.assets.bankKgs).toBe('0.00');
    expect(sheet.equity.investorCapitalKgs).toBe(OPENING_INVESTOR_CAPITAL_KGS);
    expect(sheet.differenceKgs).toBe('0.00');
    expect(sheet.assets.totalAssetsKgs).toBe(sheet.liabilitiesPlusEquityKgs);
  });

  it('company bank comes from account 1010, not from cash 1000 or employee wallets', () => {
    const opening = journal(DAY1, buildOpeningInvestorCapitalLines(), 'OPENING_BALANCE');
    const transferToBank = journal(
      DAY2,
      [line(ACCOUNT_CODE.BANK, '500.00', 0), line(ACCOUNT_CODE.CASH, 0, '500.00')],
      'TRANSFER',
    );
    const dashboard = buildFinanceDashboard({
      journals: [opening, transferToBank],
      from: DAY1,
      to: new Date('2026-01-31T23:59:59.999Z'),
    });
    expect(dashboard.companyBankKgs).toBe('500.00');
    expect(dashboard.companyCashKgs).toBe('2584212.00');
    expect(dashboard.investorCapitalKgs).toBe(OPENING_INVESTOR_CAPITAL_KGS);
    expect(dashboard.companyCashKgs).not.toBe(OPERATIONAL_WALLET_STATED_KGS);
    expect(dashboard.balanceDifferenceKgs).toBe('0.00');
  });

  it('ignores VOIDED journals so owner cash is not taken from cancelled documents', () => {
    const opening = journal(DAY1, buildOpeningInvestorCapitalLines(), 'OPENING_BALANCE');
    const voidedSale = journal(
      DAY2,
      buildCashSaleLines({ revenueKgs: '500000', cogsKgs: '300000' }),
      'SALE',
    );
    voidedSale.status = 'VOIDED';
    const dashboard = buildFinanceDashboard({
      journals: [opening, voidedSale],
      from: DAY1,
      to: new Date('2026-01-31T23:59:59.999Z'),
    });
    expect(dashboard.companyCashKgs).toBe(OPENING_INVESTOR_CAPITAL_KGS);
    expect(dashboard.salesRevenueKgs).toBe('0.00');
    expect(dashboard.cogsKgs).toBe('0.00');
    expect(dashboard.balanceDifferenceKgs).toBe('0.00');
  });
});

describe('opening investor capital business date 2026-05-01', () => {
  const postedAt = openingInvestorCapitalPostedAt();
  const opening = journal(postedAt, buildOpeningInvestorCapitalLines(), 'OPENING_BALANCE');
  const april30 = new Date('2026-04-30T23:59:59.999Z');
  const may1Start = new Date('2026-05-01T00:00:00.000Z');
  const may1End = new Date('2026-05-01T23:59:59.999Z');
  const may2Start = new Date('2026-05-02T00:00:00.000Z');
  const may31 = new Date('2026-05-31T23:59:59.999Z');

  it('uses 2026-05-01 as the opening capital date', () => {
    expect(OPENING_INVESTOR_CAPITAL_POSTED_ON).toBe('2026-05-01');
    expect(postedAt.toISOString()).toBe('2026-05-01T00:00:00.000Z');
  });

  it('includes investor contribution in ДДС on 01.05.2026', () => {
    const dds = buildCashFlowStatement({
      journals: [opening],
      from: may1Start,
      to: may1End,
      groupBy: 'day',
    });
    expect(dds.openingCashKgs).toBe('0.00');
    expect(dds.investorContributionsKgs).toBe(OPENING_INVESTOR_CAPITAL_KGS);
    expect(dds.closingCashKgs).toBe(OPENING_INVESTOR_CAPITAL_KGS);
    expect(dds.periods).toHaveLength(1);
    expect(dds.periods[0].key).toBe('2026-05-01');
    expect(dds.periods[0].investorContributionsKgs).toBe(OPENING_INVESTOR_CAPITAL_KGS);
  });

  it('does not treat investor capital as a period inflow before 01.05.2026', () => {
    const dds = buildCashFlowStatement({
      journals: [opening],
      from: new Date('2026-04-01T00:00:00.000Z'),
      to: april30,
    });
    expect(dds.investorContributionsKgs).toBe('0.00');
    expect(dds.openingCashKgs).toBe('0.00');
    expect(dds.closingCashKgs).toBe('0.00');
  });

  it('moves investor capital into opening cash after 01.05.2026', () => {
    const dds = buildCashFlowStatement({
      journals: [opening],
      from: may2Start,
      to: may31,
    });
    expect(dds.openingCashKgs).toBe(OPENING_INVESTOR_CAPITAL_KGS);
    expect(dds.investorContributionsKgs).toBe('0.00');
    expect(dds.closingCashKgs).toBe(OPENING_INVESTOR_CAPITAL_KGS);
  });

  it('balance sheet as of 30.04.2026 does not include opening capital', () => {
    const sheet = buildBalanceSheet(linesOnOrBefore(flattenJournalLines([opening]), april30));
    expect(sheet.assets.cashKgs).toBe('0.00');
    expect(sheet.equity.investorCapitalKgs).toBe('0.00');
    expect(sheet.differenceKgs).toBe('0.00');
  });

  it('balance sheet as of 01.05.2026 includes cash and investor capital', () => {
    const sheet = buildBalanceSheet(linesOnOrBefore(flattenJournalLines([opening]), may1End));
    expect(sheet.assets.cashKgs).toBe(OPENING_INVESTOR_CAPITAL_KGS);
    expect(sheet.assets.bankKgs).toBe('0.00');
    expect(sheet.equity.investorCapitalKgs).toBe(OPENING_INVESTOR_CAPITAL_KGS);
    expect(sheet.differenceKgs).toBe('0.00');
  });
});

describe('purchase logistics landed-cost scenario', () => {
  const DAY = new Date('2026-06-01T00:00:00.000Z');
  const PAY_DAY = new Date('2026-06-10T00:00:00.000Z');

  function scenarioJournals() {
    const opening = journal(DAY1, buildOpeningInvestorCapitalLines(), 'OPENING_BALANCE');
    const goods = journal(
      DAY,
      buildPartialPurchaseLines({ inventoryKgs: '1000000', paidKgs: '700000' }),
      'PURCHASE_RECEIPT',
    );
    const china = journal(
      DAY,
      buildLogisticsCostLines({
        amountKgs: '50000',
        paidKgs: '50000',
        payableAccountCode: ACCOUNT_CODE.TRANSPORT_AP,
      }),
      'LOGISTICS_CHINA',
    );
    const cargo = journal(
      DAY,
      buildLogisticsCostLines({
        amountKgs: '100000',
        paidKgs: '60000',
        payableAccountCode: ACCOUNT_CODE.CARGO_AP,
      }),
      'CARGO',
    );
    const kg = journal(
      DAY,
      buildLogisticsCostLines({
        amountKgs: '30000',
        payableAccountCode: ACCOUNT_CODE.TRANSPORT_AP,
      }),
      'LOGISTICS_KYRGYZSTAN',
    );
    return { opening, goods, china, cargo, kg, journals: [opening, goods, china, cargo, kg] };
  }

  it('caps inventory at 1,180,000 without double counting or ОПУ expense', () => {
    const { journals } = scenarioJournals();
    const posted = journals.flatMap((row) => row.lines);
    expect(debitNormalBalance(posted, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('1180000.00');
    expect(debitNormalBalance(posted, ACCOUNT_CODE.CASH).toFixed(2)).toBe('1774712.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.SUPPLIER_AP).toFixed(2)).toBe('300000.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe('40000.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.TRANSPORT_AP).toFixed(2)).toBe('30000.00');
    const pl = buildProfitAndLoss(posted);
    expect(pl.operatingExpensesKgs).toBe('0.00');
    expect(pl.cogsKgs).toBe('0.00');
    const sheet = buildBalanceSheet(posted);
    expect(sheet.assets.inventoryKgs).toBe('1180000.00');
    expect(sheet.liabilities.supplierApKgs).toBe('300000.00');
    expect(sheet.liabilities.cargoApKgs).toBe('40000.00');
    expect(sheet.liabilities.transportApKgs).toBe('30000.00');
    expect(sheet.liabilities.totalLiabilitiesKgs).toBe('370000.00');
    expect(sheet.differenceKgs).toBe('0.00');
  });

  it('ДДС uses actual payment dates and logistics cash-out categories', () => {
    const { journals } = scenarioJournals();
    const laterPay = journal(
      PAY_DAY,
      buildLogisticsApPaymentLines({
        amountKgs: '40000',
        payableAccountCode: ACCOUNT_CODE.CARGO_AP,
      }),
      'CARGO_PAYMENT',
    );
    const ddsBefore = buildCashFlowStatement({
      journals,
      from: DAY,
      to: new Date('2026-06-05T23:59:59.999Z'),
    });
    expect(ddsBefore.chinaTransportPaymentsKgs).toBe('50000.00');
    expect(ddsBefore.cargoPaymentsKgs).toBe('60000.00');
    expect(ddsBefore.kyrgyzstanTransportPaymentsKgs).toBe('0.00');
    expect(ddsBefore.supplierPaymentsKgs).toBe('700000.00');

    const ddsPay = classifyJournalCashFlow(laterPay);
    expect(ddsPay.cargoPaymentsKgs).toBe('40000.00');
    const afterPay = [...journals.flatMap((row) => row.lines), ...laterPay.lines];
    expect(debitNormalBalance(afterPay, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('1180000.00');
    expect(creditNormalBalance(afterPay, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe('0.00');
  });

  it('reversal of unpaid logistics nets inventory and AP to zero', () => {
    const recognize = journal(
      DAY,
      buildLogisticsCostLines({
        amountKgs: '30000',
        payableAccountCode: ACCOUNT_CODE.TRANSPORT_AP,
      }),
      'LOGISTICS_KYRGYZSTAN',
    );
    const reversal = journal(PAY_DAY, reverseJournalLines(recognize.lines), 'REVERSAL');
    const posted = [...recognize.lines, ...reversal.lines];
    expect(debitNormalBalance(posted, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('0.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.TRANSPORT_AP).toFixed(2)).toBe('0.00');
  });
});

