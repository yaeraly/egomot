import {
  rebuildInventoryFromLedgerMovements,
  rebuildInventoryFromReceiptMovements,
} from './rebuild-inventory-from-ledger';
import { computeInventoryAfterSale, computeInventoryAfterSaleReverse } from '../sales/sale-calc';

describe('rebuild-inventory-from-ledger', () => {
  it('rebuilds stock from purchase receipt movements only', () => {
    const snapshots = rebuildInventoryFromReceiptMovements(
      [
        {
          productId: 'p1',
          quantity: '100',
          unitCost: '10',
          transactionDate: new Date(Date.UTC(2026, 4, 1)),
          createdAt: new Date(Date.UTC(2026, 4, 1, 10)),
        },
        {
          productId: 'p1',
          quantity: '50',
          unitCost: '12',
          transactionDate: new Date(Date.UTC(2026, 4, 20)),
          createdAt: new Date(Date.UTC(2026, 4, 20, 10)),
        },
      ],
      ['p1'],
    );

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].quantity).toBe('150.000');
    expect(snapshots[0].totalValueKgs).toBe('1600.00');
  });

  it('resets products with no remaining receipt movements to zero', () => {
    const snapshots = rebuildInventoryFromReceiptMovements([], ['p-sold-only']);
    expect(snapshots[0].quantity).toBe('0.000');
    expect(snapshots[0].totalValueKgs).toBe('0.00');
  });

  it('rebuilds stock from purchase receipts followed by sales', () => {
    const snapshots = rebuildInventoryFromLedgerMovements(
      [
        {
          productId: 'p1',
          type: 'PURCHASE_RECEIPT' as const,
          quantity: '100',
          unitCost: '10',
          transactionDate: new Date(Date.UTC(2026, 4, 1)),
          createdAt: new Date(Date.UTC(2026, 4, 1, 10)),
        },
        {
          productId: 'p1',
          type: 'SALE' as const,
          quantity: '30',
          unitCost: '10',
          transactionDate: new Date(Date.UTC(2026, 4, 15)),
          createdAt: new Date(Date.UTC(2026, 4, 15, 10)),
        },
      ],
      ['p1'],
    );

    expect(snapshots[0].quantity).toBe('70.000');
    expect(snapshots[0].totalValueKgs).toBe('700.00');
  });
});

describe('computeInventoryAfterSaleReverse', () => {
  it('restores quantity and WAC value using the sale movement cost', () => {
    const afterSale = computeInventoryAfterSale({
      currentQuantity: '20',
      currentTotalValueKgs: '200000',
      soldQuantity: '3',
    });
    const restored = computeInventoryAfterSaleReverse({
      currentQuantity: afterSale.newQuantity,
      currentTotalValueKgs: afterSale.newTotalValueKgs,
      soldQuantity: '3',
      saleTotalCostKgs: afterSale.totalCost,
    });

    expect(restored.newQuantity.toFixed(3)).toBe('20.000');
    expect(restored.newTotalValueKgs.toFixed(2)).toBe('200000.00');
  });

  it('does not invent cost from the current purchase price', () => {
    const restored = computeInventoryAfterSaleReverse({
      currentQuantity: '10',
      currentTotalValueKgs: '1000',
      soldQuantity: '5',
      saleTotalCostKgs: '400',
    });
    expect(restored.newQuantity.toFixed(3)).toBe('15.000');
    expect(restored.newTotalValueKgs.toFixed(2)).toBe('1400.00');
    expect(restored.unitCost.toFixed(4)).toBe('80.0000');
  });
});
