import {
  calculateReceipt,
  computeInventoryAfterReceipt,
  PurchaseValidationError,
} from './receipt-calc';

describe('receipt calculations', () => {
  const baseItem = {
    productId: 'p1',
    orderedQuantity: 100,
    unitPriceCny: 10,
    unitWeightKg: 1,
  };

  it('1. receive exact quantity', () => {
    const result = calculateReceipt({
      exchangeRateCnyToKgs: 12,
      items: [{ ...baseItem, receivedQuantity: 100 }],
      transport: {
        chinaInternalTransportKgs: 0,
        cargoKgs: 0,
        kyrgyzstanInternalTransportKgs: 0,
      },
    });
    expect(result.items[0].difference.toFixed(3)).toBe('0.000');
    expect(result.discrepancies).toHaveLength(0);
  });

  it('2. receive less than ordered (shortage)', () => {
    const result = calculateReceipt({
      exchangeRateCnyToKgs: 12,
      items: [{ ...baseItem, receivedQuantity: 98 }],
      transport: {
        chinaInternalTransportKgs: 0,
        cargoKgs: 0,
        kyrgyzstanInternalTransportKgs: 0,
      },
    });
    expect(result.items[0].difference.toFixed(3)).toBe('-2.000');
    expect(result.discrepancies).toHaveLength(1);
    expect(result.discrepancies[0].type).toBe('SHORTAGE');
  });

  it('3. receive more than ordered (excess)', () => {
    const result = calculateReceipt({
      exchangeRateCnyToKgs: 12,
      items: [{ ...baseItem, receivedQuantity: 102 }],
      transport: {
        chinaInternalTransportKgs: 0,
        cargoKgs: 0,
        kyrgyzstanInternalTransportKgs: 0,
      },
    });
    expect(result.items[0].difference.toFixed(3)).toBe('2.000');
    expect(result.discrepancies[0].type).toBe('EXCESS');
  });

  it('4. calculate shortage totals', () => {
    const result = calculateReceipt({
      exchangeRateCnyToKgs: 1,
      items: [{ ...baseItem, receivedQuantity: 98 }],
      transport: {
        chinaInternalTransportKgs: 0,
        cargoKgs: 0,
        kyrgyzstanInternalTransportKgs: 0,
      },
    });
    expect(result.totals.totalShortage.toFixed(3)).toBe('2.000');
    expect(result.totals.totalExcess.toFixed(3)).toBe('0.000');
  });

  it('5. calculate excess totals', () => {
    const result = calculateReceipt({
      exchangeRateCnyToKgs: 1,
      items: [{ ...baseItem, receivedQuantity: 102 }],
      transport: {
        chinaInternalTransportKgs: 0,
        cargoKgs: 0,
        kyrgyzstanInternalTransportKgs: 0,
      },
    });
    expect(result.totals.totalExcess.toFixed(3)).toBe('2.000');
  });

  it('6. allocate transport by actual received weight', () => {
    const result = calculateReceipt({
      exchangeRateCnyToKgs: 1,
      items: [
        { productId: 'a', orderedQuantity: 100, receivedQuantity: 100, unitPriceCny: 1, unitWeightKg: 1 },
        { productId: 'b', orderedQuantity: 50, receivedQuantity: 50, unitPriceCny: 1, unitWeightKg: 2 },
      ],
      transport: {
        chinaInternalTransportKgs: 50000,
        cargoKgs: 0,
        kyrgyzstanInternalTransportKgs: 0,
      },
    });
    expect(result.items[0].allocatedChinaTransportKgs.toFixed(2)).toBe('25000.00');
    expect(result.items[1].allocatedChinaTransportKgs.toFixed(2)).toBe('25000.00');
    expect(result.totals.totalTransportKgs.toFixed(2)).toBe('50000.00');
  });

  it('7. calculate landed cost', () => {
    const result = calculateReceipt({
      exchangeRateCnyToKgs: 10,
      items: [{ productId: 'a', orderedQuantity: 10, receivedQuantity: 10, unitPriceCny: 5, unitWeightKg: 2 }],
      transport: {
        chinaInternalTransportKgs: 100,
        cargoKgs: 0,
        kyrgyzstanInternalTransportKgs: 0,
      },
    });
    expect(result.items[0].purchaseCostKgs.toFixed(2)).toBe('500.00');
    expect(result.items[0].totalLandedCostKgs.toFixed(2)).toBe('600.00');
    expect(result.items[0].unitLandedCostKgs.toFixed(4)).toBe('60.0000');
  });

  it('8. inventory increases only by actual quantity', () => {
    const inv = computeInventoryAfterReceipt({
      currentQuantity: 50,
      currentTotalValueKgs: 0,
      receivedQuantity: 98,
      unitLandedCostKgs: 10,
    });
    expect(inv.newQuantity.toFixed(3)).toBe('148.000');
    expect(inv.previousQuantity.toFixed(3)).toBe('50.000');
  });

  it('9. negative received quantity rejected', () => {
    expect(() =>
      calculateReceipt({
        exchangeRateCnyToKgs: 1,
        items: [{ ...baseItem, receivedQuantity: -1 }],
        transport: {
          chinaInternalTransportKgs: 0,
          cargoKgs: 0,
          kyrgyzstanInternalTransportKgs: 0,
        },
      }),
    ).toThrow(PurchaseValidationError);
  });

  it('10. transport allocation requires positive weight when transport > 0', () => {
    expect(() =>
      calculateReceipt({
        exchangeRateCnyToKgs: 1,
        items: [{ ...baseItem, receivedQuantity: 0 }],
        transport: {
          chinaInternalTransportKgs: 100,
          cargoKgs: 0,
          kyrgyzstanInternalTransportKgs: 0,
        },
      }),
    ).toThrow(PurchaseValidationError);
  });

  it('11. weighted average inventory value', () => {
    const inv = computeInventoryAfterReceipt({
      currentQuantity: 50,
      currentTotalValueKgs: 500,
      receivedQuantity: 98,
      unitLandedCostKgs: 10,
    });
    expect(inv.newTotalValueKgs.toFixed(2)).toBe('1480.00');
    expect(inv.averageUnitCostKgs.toFixed(4)).toBe('10.0000');
  });

  it('12. shortage example ordered 100 received 98', () => {
    const result = calculateReceipt({
      exchangeRateCnyToKgs: 12,
      items: [{ ...baseItem, receivedQuantity: 98 }],
      transport: {
        chinaInternalTransportKgs: 20000,
        cargoKgs: 20000,
        kyrgyzstanInternalTransportKgs: 10000,
      },
    });
    expect(result.items[0].receivedQuantity.toFixed(3)).toBe('98.000');
    expect(result.items[0].difference.toFixed(3)).toBe('-2.000');
    expect(result.totals.totalTransportKgs.toFixed(2)).toBe('50000.00');
    expect(result.totals.totalLandedCostKgs.gt(0)).toBe(true);

    const inv = computeInventoryAfterReceipt({
      currentQuantity: 50,
      currentTotalValueKgs: 0,
      receivedQuantity: result.items[0].receivedQuantity,
      unitLandedCostKgs: result.items[0].unitLandedCostKgs,
    });
    expect(inv.newQuantity.toFixed(3)).toBe('148.000');
  });
});
