import {
  computeInventoryAfterSale,
  resolvePaymentStatus,
  validatePaymentEntries,
  SaleValidationError,
} from './sale-calc';
import { dec } from '../purchases/purchase-calc';

describe('sale-calc', () => {
  it('deducts inventory on sale', () => {
    const result = computeInventoryAfterSale({
      currentQuantity: '20',
      currentTotalValueKgs: '200000',
      soldQuantity: '3',
    });
    expect(result.newQuantity.toFixed(3)).toBe('17.000');
    expect(result.totalCost.toFixed(2)).toBe('30000.00');
  });

  it('rejects insufficient stock', () => {
    expect(() =>
      computeInventoryAfterSale({
        currentQuantity: '2',
        currentTotalValueKgs: '20000',
        soldQuantity: '3',
      }),
    ).toThrow(SaleValidationError);
  });

  it('validates mixed payments', () => {
    const result = validatePaymentEntries('50000', [
      { amountKgs: '20000' },
      { amountKgs: '15000' },
      { amountKgs: '5000' },
    ]);
    expect(result.paidAmountKgs.toFixed(2)).toBe('40000.00');
    expect(result.debtAmountKgs.toFixed(2)).toBe('10000.00');
  });

  it('rejects overpayment', () => {
    expect(() =>
      validatePaymentEntries('50000', [{ amountKgs: '60000' }]),
    ).toThrow(SaleValidationError);
  });

  it('resolves payment status', () => {
    expect(resolvePaymentStatus(dec('50000'), dec('50000'))).toBe('PAID');
    expect(resolvePaymentStatus(dec('50000'), dec('30000'))).toBe('PARTIAL');
    expect(resolvePaymentStatus(dec('50000'), dec('0'))).toBe('UNPAID');
  });

  it('supports full cash payment', () => {
    const result = validatePaymentEntries('50000', [{ amountKgs: '50000' }]);
    expect(result.paidAmountKgs.toFixed(2)).toBe('50000.00');
    expect(result.debtAmountKgs.toFixed(2)).toBe('0.00');
    expect(resolvePaymentStatus(dec('50000'), result.paidAmountKgs)).toBe('PAID');
  });

  it('supports full MBank payment', () => {
    const result = validatePaymentEntries('50000', [{ amountKgs: '50000' }]);
    expect(result.debtAmountKgs.toFixed(2)).toBe('0.00');
  });

  it('supports mixed Cash + MBank + wallet', () => {
    const result = validatePaymentEntries('50000', [
      { amountKgs: '20000' },
      { amountKgs: '15000' },
      { amountKgs: '5000' },
    ]);
    expect(result.paidAmountKgs.toFixed(2)).toBe('40000.00');
    expect(result.debtAmountKgs.toFixed(2)).toBe('10000.00');
  });

  it('creates debt on partial payment', () => {
    const result = validatePaymentEntries('100000', [{ amountKgs: '70000' }]);
    expect(result.debtAmountKgs.toFixed(2)).toBe('30000.00');
    expect(resolvePaymentStatus(dec('100000'), result.paidAmountKgs)).toBe('PARTIAL');
  });

  it('rejects zero overpayment edge case', () => {
    const result = validatePaymentEntries('50000', [{ amountKgs: '0' }]);
    expect(result.paidAmountKgs.toFixed(2)).toBe('0.00');
    expect(result.debtAmountKgs.toFixed(2)).toBe('50000.00');
  });

  it('rejects negative payment amounts', () => {
    expect(() =>
      validatePaymentEntries('50000', [{ amountKgs: '-100' }]),
    ).toThrow(SaleValidationError);
  });

  it('deducts inventory even when debt remains', () => {
    const result = computeInventoryAfterSale({
      currentQuantity: '20',
      currentTotalValueKgs: '200000',
      soldQuantity: '3',
    });
    expect(result.newQuantity.toFixed(3)).toBe('17.000');
  });
});
