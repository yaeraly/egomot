import {
  compareInventorySnapshots,
  PurchaseRebuildInventorySnapshot,
  resolveReceivablePurchaseStatus,
} from './purchase-rebuild.logic';

describe('purchase-rebuild.logic', () => {
  it('maps received purchases to a receivable intermediate status', () => {
    expect(resolveReceivablePurchaseStatus('RECEIVED')).toBe('ARRIVED');
    expect(resolveReceivablePurchaseStatus('RECEIVED_WITH_DISCREPANCY')).toBe('ARRIVED');
    expect(resolveReceivablePurchaseStatus('ORDERED')).toBe('ORDERED');
  });

  it('detects inventory mismatches after rebuild', () => {
    const before: PurchaseRebuildInventorySnapshot[] = [
      {
        productId: 'p1',
        productCode: 'PRD-0001',
        productName: 'Product A',
        quantity: '10.000',
        averageUnitCostKgs: '100.0000',
        totalValueKgs: '1000.00',
      },
    ];
    const after: PurchaseRebuildInventorySnapshot[] = [
      {
        ...before[0],
        quantity: '9.000',
      },
    ];

    expect(compareInventorySnapshots(before, after)).toEqual([
      'PRD-0001: quantity 9.000, expected 10.000',
    ]);
  });
});
