import {
  allocateByWeight,
  calculatePurchase,
  dec,
  moneyStr,
  PurchaseValidationError,
  roundMoney,
  roundUnitCost,
  roundWeight,
} from './purchase-calc';
import { validatePurchaseInput } from './purchase-validate';
import {
  AUDIT_ACTIONS,
  assertValidStatus,
  buildPurchaseAuditEvents,
  PurchaseSnapshot,
} from './purchase-audit';

describe('purchase calculations', () => {
  it('1. quantity × CNY price', () => {
    const result = calculatePurchase({
      exchangeRateCnyToKgs: 12,
      items: [
        {
          productId: 'a',
          quantity: 10,
          unitPriceCny: 25.5,
          unitWeightKg: 1,
        },
      ],
      logistics: [],
    });
    expect(result.items[0].totalCny.toFixed(2)).toBe('255.00');
  });

  it('2. CNY → KGS conversion', () => {
    const result = calculatePurchase({
      exchangeRateCnyToKgs: 12.35,
      items: [
        {
          productId: 'a',
          quantity: 10,
          unitPriceCny: 20,
          unitWeightKg: 1,
        },
      ],
      logistics: [],
    });
    expect(result.items[0].totalCny.toFixed(2)).toBe('200.00');
    expect(result.items[0].purchaseCostKgs.toFixed(2)).toBe('2470.00');
  });

  it('3. total item weight', () => {
    const result = calculatePurchase({
      exchangeRateCnyToKgs: 1,
      items: [
        {
          productId: 'a',
          quantity: 10,
          unitPriceCny: 1,
          unitWeightKg: 10,
        },
      ],
      logistics: [],
    });
    expect(result.items[0].totalWeightKg.toFixed(3)).toBe('100.000');
  });

  it('4. total purchase weight', () => {
    const result = calculatePurchase({
      exchangeRateCnyToKgs: 1,
      items: [
        { productId: 'a', quantity: 10, unitPriceCny: 1, unitWeightKg: 10 },
        { productId: 'b', quantity: 20, unitPriceCny: 1, unitWeightKg: 20 },
      ],
      logistics: [],
    });
    expect(result.totals.totalWeightKg.toFixed(3)).toBe('500.000');
  });

  it('5. logistics allocation by weight (spec example)', () => {
    const result = calculatePurchase({
      exchangeRateCnyToKgs: 1,
      items: [
        { productId: 'a', quantity: 10, unitPriceCny: 0, unitWeightKg: 10 },
        { productId: 'b', quantity: 20, unitPriceCny: 0, unitWeightKg: 20 },
      ],
      logistics: [
        {
          type: 'CARGO',
          amount: 100000,
          currency: 'KGS',
        },
      ],
    });

    expect(result.items[0].totalWeightKg.toFixed(3)).toBe('100.000');
    expect(result.items[1].totalWeightKg.toFixed(3)).toBe('400.000');
    expect(result.items[0].allocatedCargoKgs.toFixed(2)).toBe('20000.00');
    expect(result.items[1].allocatedCargoKgs.toFixed(2)).toBe('80000.00');
    const allocated = result.items[0].allocatedCargoKgs.plus(result.items[1].allocatedCargoKgs);
    expect(allocated.toFixed(2)).toBe('100000.00');
  });

  it('6. multiple logistics types', () => {
    const result = calculatePurchase({
      exchangeRateCnyToKgs: 12,
      items: [
        { productId: 'a', quantity: 10, unitPriceCny: 10, unitWeightKg: 10 },
        { productId: 'b', quantity: 20, unitPriceCny: 10, unitWeightKg: 20 },
      ],
      logistics: [
        { type: 'CHINA_INTERNAL_TRANSPORT', amount: 1000, currency: 'CNY', exchangeRate: 12 },
        { type: 'CARGO', amount: 50000, currency: 'KGS' },
        { type: 'KYRGYZSTAN_INTERNAL_TRANSPORT', amount: 8000, currency: 'KGS' },
        { type: 'OTHER', amount: 2000, currency: 'KGS' },
      ],
    });

    expect(result.totals.totalChinaTransportKgs.toFixed(2)).toBe('12000.00');
    expect(result.totals.totalCargoKgs.toFixed(2)).toBe('50000.00');
    expect(result.totals.totalKgInternalTransportKgs.toFixed(2)).toBe('8000.00');
    expect(result.totals.totalOtherLogisticsKgs.toFixed(2)).toBe('2000.00');
    expect(result.totals.totalLogisticsKgs.toFixed(2)).toBe('72000.00');

    const itemAllocSum = result.items.reduce(
      (sum, item) => sum.plus(item.totalAllocatedLogisticsKgs),
      dec(0),
    );
    expect(itemAllocSum.toFixed(2)).toBe(result.totals.totalLogisticsKgs.toFixed(2));
  });

  it('7. estimated landed cost', () => {
    const result = calculatePurchase({
      exchangeRateCnyToKgs: 10,
      items: [
        { productId: 'a', quantity: 10, unitPriceCny: 10, unitWeightKg: 10 },
        { productId: 'b', quantity: 20, unitPriceCny: 10, unitWeightKg: 20 },
      ],
      logistics: [{ type: 'CARGO', amount: 100000, currency: 'KGS' }],
    });

    expect(result.items[0].purchaseCostKgs.toFixed(2)).toBe('1000.00');
    expect(result.items[0].totalAllocatedLogisticsKgs.toFixed(2)).toBe('20000.00');
    expect(result.items[0].estimatedLandedCostKgs.toFixed(2)).toBe('21000.00');
    expect(result.items[1].purchaseCostKgs.toFixed(2)).toBe('2000.00');
    expect(result.items[1].totalAllocatedLogisticsKgs.toFixed(2)).toBe('80000.00');
    expect(result.items[1].estimatedLandedCostKgs.toFixed(2)).toBe('82000.00');
  });

  it('8. estimated unit landed cost', () => {
    const result = calculatePurchase({
      exchangeRateCnyToKgs: 10,
      items: [
        { productId: 'a', quantity: 10, unitPriceCny: 10, unitWeightKg: 10 },
        { productId: 'b', quantity: 20, unitPriceCny: 10, unitWeightKg: 20 },
      ],
      logistics: [{ type: 'CARGO', amount: 100000, currency: 'KGS' }],
    });

    expect(result.items[0].estimatedUnitLandedCostKgs.toFixed(4)).toBe('2100.0000');
    expect(result.items[1].estimatedUnitLandedCostKgs.toFixed(4)).toBe('4100.0000');
  });

  it('9. rounding / decimal precision and remainder reconciliation', () => {
    const weights = [dec(1), dec(1), dec(1)];
    const allocated = allocateByWeight(weights, roundMoney(10));
    expect(allocated[0].toFixed(2)).toBe('3.33');
    expect(allocated[1].toFixed(2)).toBe('3.33');
    expect(allocated[2].toFixed(2)).toBe('3.34');
    const sum = allocated.reduce((s, v) => s.plus(v), dec(0));
    expect(sum.toFixed(2)).toBe('10.00');

    const result = calculatePurchase({
      exchangeRateCnyToKgs: '12.345678',
      items: [
        { productId: 'a', quantity: '1.5', unitPriceCny: '10.3333', unitWeightKg: '0.333' },
        { productId: 'b', quantity: '2.25', unitPriceCny: '7.1', unitWeightKg: '0.667' },
      ],
      logistics: [{ type: 'CARGO', amount: '100.01', currency: 'KGS' }],
    });

    const allocSum = result.items.reduce(
      (s, item) => s.plus(item.totalAllocatedLogisticsKgs),
      dec(0),
    );
    expect(allocSum.toFixed(2)).toBe(result.totals.totalLogisticsKgs.toFixed(2));
    expect(result.totals.totalLogisticsKgs.toFixed(2)).toBe('100.01');
    expect(moneyStr(result.items[0].totalCny)).toMatch(/^\d+\.\d{2}$/);
    expect(roundWeight(result.items[0].totalWeightKg).toFixed(3)).toMatch(/^\d+\.\d{3}$/);
    expect(roundUnitCost(result.items[0].estimatedUnitLandedCostKgs).toFixed(4)).toMatch(
      /^\d+\.\d{4}$/,
    );
  });
});

describe('purchase validation', () => {
  const valid = {
    supplierId: 'sup-1',
    exchangeRateCnyToKgs: 12,
    items: [{ productId: 'p1', quantity: 1, unitPriceCny: 10, unitWeightKg: 1 }],
    logistics: [] as PurchaseCalcInputLogistics[],
  };

  it('10. rejects invalid purchase input', () => {
    expect(() => validatePurchaseInput({ ...valid, supplierId: '' })).toThrow(
      PurchaseValidationError,
    );
    expect(() => validatePurchaseInput({ ...valid, items: [] })).toThrow(/хотя бы одну позицию/);
    expect(() =>
      validatePurchaseInput({
        ...valid,
        items: [{ productId: 'p1', quantity: 0, unitPriceCny: 10, unitWeightKg: 1 }],
      }),
    ).toThrow(/количество/);
    expect(() =>
      validatePurchaseInput({
        ...valid,
        items: [{ productId: 'p1', quantity: 1, unitPriceCny: -1, unitWeightKg: 1 }],
      }),
    ).toThrow(/отрицательной/);
    expect(() =>
      validatePurchaseInput({
        ...valid,
        items: [{ productId: 'p1', quantity: 1, unitPriceCny: 1, unitWeightKg: 0 }],
      }),
    ).toThrow(/вес/);
    expect(() => validatePurchaseInput({ ...valid, exchangeRateCnyToKgs: 0 })).toThrow(/Курс/);
    expect(() =>
      validatePurchaseInput({
        ...valid,
        logistics: [{ type: 'CARGO', amount: -10, currency: 'KGS' }],
      }),
    ).toThrow(/отрицательной/);
    expect(() =>
      calculatePurchase({
        exchangeRateCnyToKgs: 1,
        items: [{ productId: 'a', quantity: 1, unitPriceCny: 1, unitWeightKg: 0.001 }],
        logistics: [{ type: 'CARGO', amount: 10, currency: 'KGS' }],
      }),
    ).not.toThrow();
  });

  it('rejects logistics allocation when a product has no weight', () => {
    expect(() =>
      calculatePurchase({
        exchangeRateCnyToKgs: 1,
        items: [
          { productId: 'a', quantity: 10, unitPriceCny: 1, unitWeightKg: 6 },
          { productId: 'b', quantity: 5, unitPriceCny: 1, unitWeightKg: 0 },
        ],
        logistics: [{ type: 'CARGO', amount: 100000, currency: 'KGS' }],
      }),
    ).toThrow(/Не указан вес товара/);
  });
});

type PurchaseCalcInputLogistics = {
  type: 'CARGO';
  amount: number;
  currency: 'KGS';
};

describe('status change', () => {
  it('11. accepts valid purchase statuses including receiving', () => {
    expect(() => assertValidStatus('DRAFT')).not.toThrow();
    expect(() => assertValidStatus('ORDERED')).not.toThrow();
    expect(() => assertValidStatus('ARRIVED')).not.toThrow();
    expect(() => assertValidStatus('RECEIVED')).not.toThrow();
    expect(() => assertValidStatus('RECEIVED_WITH_DISCREPANCY')).not.toThrow();
    expect(() => assertValidStatus('COMPLETED')).toThrow(/Недопустимый статус/);
  });
});

describe('audit log creation', () => {
  const baseNext: PurchaseSnapshot = {
    id: 'pur-1',
    supplierId: 'sup-1',
    status: 'DRAFT',
    exchangeRateCnyToKgs: '12.000000',
    notes: null,
    items: [
      {
        productId: 'p1',
        quantity: '10.000',
        unitPriceCny: '20.0000',
        unitWeightKg: '1.000',
        exchangeRateCnyToKgs: '12.000000',
      },
    ],
    logistics: [],
  };

  it('12. records create, edit, product, rate, logistics and status events', () => {
    const created = buildPurchaseAuditEvents({
      purchaseId: 'pur-1',
      previous: null,
      next: baseNext,
    });
    expect(created.map((e) => e.action)).toEqual([
      AUDIT_ACTIONS.PURCHASE_CREATED,
      AUDIT_ACTIONS.PRODUCT_ADDED,
    ]);

    const edited = buildPurchaseAuditEvents({
      purchaseId: 'pur-1',
      previous: baseNext,
      next: {
        ...baseNext,
        status: 'ORDERED',
        exchangeRateCnyToKgs: '13.000000',
        items: [
          {
            productId: 'p1',
            quantity: '11.000',
            unitPriceCny: '21.0000',
            unitWeightKg: '1.200',
            exchangeRateCnyToKgs: '13.000000',
          },
          {
            productId: 'p2',
            quantity: '1.000',
            unitPriceCny: '5.0000',
            unitWeightKg: '0.500',
            exchangeRateCnyToKgs: '13.000000',
          },
        ],
        logistics: [
          {
            type: 'CARGO',
            amount: '1000.00',
            currency: 'KGS',
            exchangeRate: null,
            amountKgs: '1000.00',
            comment: 'cargo',
          },
        ],
      },
    });

    const actions = edited.map((e) => e.action);
    expect(actions).toContain(AUDIT_ACTIONS.PURCHASE_EDITED);
    expect(actions).toContain(AUDIT_ACTIONS.QUANTITY_CHANGED);
    expect(actions).toContain(AUDIT_ACTIONS.CNY_PRICE_CHANGED);
    expect(actions).toContain(AUDIT_ACTIONS.WEIGHT_CHANGED);
    expect(actions).toContain(AUDIT_ACTIONS.EXCHANGE_RATE_CHANGED);
    expect(actions).toContain(AUDIT_ACTIONS.PRODUCT_ADDED);
    expect(actions).toContain(AUDIT_ACTIONS.LOGISTICS_ADDED);
    expect(actions).toContain(AUDIT_ACTIONS.STATUS_CHANGED);

    const removed = buildPurchaseAuditEvents({
      purchaseId: 'pur-1',
      previous: baseNext,
      next: { ...baseNext, items: [] },
    });
    expect(removed.map((e) => e.action)).toContain(AUDIT_ACTIONS.PRODUCT_REMOVED);
  });
});
