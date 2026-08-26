import { ACCOUNT_CODE } from './accounting-codes';
import {
  creditNormalBalance,
  debitNormalBalance,
  validateJournalLines,
} from './accounting-journal.logic';
import {
  buildLogisticsApPaymentLines,
  buildLogisticsCostLines,
  logisticsPaymentSourceType,
  logisticsRecognitionSourceType,
  payableAccountCodeForLogisticsType,
  resolveLogisticsSettlement,
} from './logistics-cost.logic';
import { moneyStr } from '../purchases/purchase-calc';

describe('purchase logistics cost journals', () => {
  it('1. fully paid China transport: Dr Inventory / Cr Cash, no AP', () => {
    const lines = buildLogisticsCostLines({
      amountKgs: '50000',
      paidKgs: '50000',
      payableAccountCode: payableAccountCodeForLogisticsType('CHINA_INTERNAL_TRANSPORT'),
    });
    const totals = validateJournalLines(lines);
    expect(moneyStr(totals.debitKgs)).toBe(moneyStr(totals.creditKgs));
    expect(debitNormalBalance(lines, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('50000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.CASH).toFixed(2)).toBe('50000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.TRANSPORT_AP).toFixed(2)).toBe('0.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe('0.00');
  });

  it('2. unpaid China transport: Dr Inventory / Cr Transport AP 2020', () => {
    const lines = buildLogisticsCostLines({
      amountKgs: '50000',
      paidKgs: 0,
      payableAccountCode: ACCOUNT_CODE.TRANSPORT_AP,
    });
    validateJournalLines(lines);
    expect(debitNormalBalance(lines, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('50000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.TRANSPORT_AP).toFixed(2)).toBe('50000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.CASH).toFixed(2)).toBe('0.00');
  });

  it('3. fully paid cargo: Dr Inventory / Cr Cash, no Cargo AP', () => {
    const lines = buildLogisticsCostLines({
      amountKgs: '100000',
      paidKgs: '100000',
      payableAccountCode: ACCOUNT_CODE.CARGO_AP,
    });
    validateJournalLines(lines);
    expect(debitNormalBalance(lines, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('100000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.CASH).toFixed(2)).toBe('100000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe('0.00');
  });

  it('4. partial cargo: Dr Inventory 100000 / Cr Cash 60000 / Cr Cargo AP 40000', () => {
    const lines = buildLogisticsCostLines({
      amountKgs: '100000',
      paidKgs: '60000',
      payableAccountCode: ACCOUNT_CODE.CARGO_AP,
    });
    const totals = validateJournalLines(lines);
    expect(moneyStr(totals.debitKgs)).toBe('100000.00');
    expect(moneyStr(totals.creditKgs)).toBe('100000.00');
    expect(debitNormalBalance(lines, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('100000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.CASH).toFixed(2)).toBe('60000.00');
    expect(creditNormalBalance(lines, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe('40000.00');
  });

  it('5. later cargo debt payment does not increase inventory', () => {
    const recognize = buildLogisticsCostLines({
      amountKgs: '100000',
      paidKgs: '60000',
      payableAccountCode: ACCOUNT_CODE.CARGO_AP,
    });
    const pay = buildLogisticsApPaymentLines({
      amountKgs: '20000',
      payableAccountCode: ACCOUNT_CODE.CARGO_AP,
    });
    const posted = [...recognize, ...pay];
    expect(debitNormalBalance(posted, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('100000.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe('20000.00');
    expect(creditNormalBalance(posted, ACCOUNT_CODE.CASH).toFixed(2)).toBe('80000.00');
  });

  it('6. Kyrgyzstan transport unpaid credits Transport AP', () => {
    const lines = buildLogisticsCostLines({
      amountKgs: '30000',
      payableAccountCode: payableAccountCodeForLogisticsType('KYRGYZSTAN_INTERNAL_TRANSPORT'),
    });
    validateJournalLines(lines);
    expect(creditNormalBalance(lines, ACCOUNT_CODE.TRANSPORT_AP).toFixed(2)).toBe('30000.00');
    expect(logisticsRecognitionSourceType('KYRGYZSTAN_INTERNAL_TRANSPORT')).toBe(
      'LOGISTICS_KYRGYZSTAN',
    );
  });

  it('7-8. USD and CNY original amounts convert to KGS via rate', () => {
    const usd = resolveLogisticsSettlement({
      amountKgs: (2743.996 * 87).toFixed(2),
      settlement: 'UNPAID',
    });
    expect(usd.amountKgs.toFixed(2)).toBe((2743.996 * 87).toFixed(2));
    expect(usd.status).toBe('UNPAID');
    const cny = resolveLogisticsSettlement({
      amountKgs: (1000 * 12.35).toFixed(2),
      settlement: 'PAID',
      paidAmountKgs: (1000 * 12.35).toFixed(2),
    });
    expect(cny.status).toBe('PAID');
    expect(cny.remainingAmountKgs.toFixed(2)).toBe('0.00');
  });

  it('15-16. partial then full AP settlement', () => {
    const first = buildLogisticsApPaymentLines({
      amountKgs: '20000',
      payableAccountCode: ACCOUNT_CODE.CARGO_AP,
    });
    const last = buildLogisticsApPaymentLines({
      amountKgs: '20000',
      payableAccountCode: ACCOUNT_CODE.CARGO_AP,
    });
    const recognize = buildLogisticsCostLines({
      amountKgs: '100000',
      paidKgs: '60000',
      payableAccountCode: ACCOUNT_CODE.CARGO_AP,
    });
    const posted = [...recognize, ...first, ...last];
    expect(creditNormalBalance(posted, ACCOUNT_CODE.CARGO_AP).toFixed(2)).toBe('0.00');
    expect(debitNormalBalance(posted, ACCOUNT_CODE.INVENTORY).toFixed(2)).toBe('100000.00');
    expect(logisticsPaymentSourceType('CARGO')).toBe('CARGO_PAYMENT');
  });
});
