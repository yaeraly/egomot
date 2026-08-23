import { Prisma } from '@prisma/client';
import {
  buildChronologicalLedger,
  calculateProductStock,
  calculateRequiredPurchaseQty,
  findFirstNegativeDate,
  matchesStatusFilter,
  reconcileProduct,
  resolveReconciliationStatus,
} from './inventory-reconciliation.logic';

const dec = (value: string | number) => new Prisma.Decimal(value);

describe('inventory-reconciliation.logic', () => {
  describe('calculateProductStock', () => {
    it('calculates stock from opening, purchases, adjustments, and sales', () => {
      expect(
        calculateProductStock({
          openingStock: dec(10),
          purchasedQty: dec(100),
          soldQty: dec(80),
          adjustmentIn: dec(5),
          adjustmentOut: dec(3),
        }).toFixed(3),
      ).toBe('32.000');
    });
  });

  describe('calculateRequiredPurchaseQty', () => {
    it('returns missing historical purchase quantity when sold exceeds receipts', () => {
      expect(
        calculateRequiredPurchaseQty({
          openingStock: dec(0),
          purchasedQty: dec(50),
          soldQty: dec(80),
          adjustmentIn: dec(0),
        }).toFixed(3),
      ).toBe('30.000');
    });

    it('returns zero when receipts cover sales', () => {
      expect(
        calculateRequiredPurchaseQty({
          openingStock: dec(0),
          purchasedQty: dec(100),
          soldQty: dec(80),
          adjustmentIn: dec(0),
        }).toFixed(3),
      ).toBe('0.000');
    });
  });

  describe('findFirstNegativeDate', () => {
    it('identifies the first date stock goes negative chronologically', () => {
      const result = findFirstNegativeDate(dec(0), [
        {
          date: new Date(Date.UTC(2026, 4, 1)),
          kind: 'PURCHASE_RECEIPT',
          quantityIn: dec(100),
          quantityOut: dec(0),
        },
        {
          date: new Date(Date.UTC(2026, 4, 3)),
          kind: 'SALE',
          quantityIn: dec(0),
          quantityOut: dec(20),
        },
        {
          date: new Date(Date.UTC(2026, 4, 5)),
          kind: 'SALE',
          quantityIn: dec(0),
          quantityOut: dec(50),
        },
        {
          date: new Date(Date.UTC(2026, 4, 8)),
          kind: 'SALE',
          quantityIn: dec(0),
          quantityOut: dec(40),
        },
      ]);

      expect(result.firstNegativeDate).toBe('2026-05-08');
      expect(result.negativeQty.toFixed(3)).toBe('10.000');
    });
  });

  describe('buildChronologicalLedger', () => {
    it('builds running balance by date', () => {
      const ledger = buildChronologicalLedger(dec(0), [
        {
          date: new Date(Date.UTC(2026, 4, 1)),
          kind: 'PURCHASE_RECEIPT',
          quantityIn: dec(100),
          quantityOut: dec(0),
        },
        {
          date: new Date(Date.UTC(2026, 4, 3)),
          kind: 'SALE',
          quantityIn: dec(0),
          quantityOut: dec(20),
        },
      ]);

      expect(ledger).toHaveLength(2);
      expect(ledger[0].runningBalance).toBe('100.000');
      expect(ledger[1].runningBalance).toBe('80.000');
    });
  });

  describe('resolveReconciliationStatus', () => {
    it('detects stock mismatch', () => {
      const result = resolveReconciliationStatus({
        calculatedStock: dec(10),
        currentStock: dec(8),
        difference: dec(2),
        requiredPurchaseQty: dec(0),
        soldQty: dec(5),
        purchasedQty: dec(15),
        openingStock: dec(0),
        firstNegativeDate: null,
        firstPurchaseDate: '2026-01-01',
        firstSaleDate: '2026-02-01',
      });
      expect(result.status).toBe('STOCK_MISMATCH');
    });

    it('detects missing purchase history for negative stock', () => {
      const result = resolveReconciliationStatus({
        calculatedStock: dec(-30),
        currentStock: dec(-30),
        difference: dec(0),
        requiredPurchaseQty: dec(30),
        soldQty: dec(130),
        purchasedQty: dec(100),
        openingStock: dec(0),
        firstNegativeDate: '2026-05-08',
        firstPurchaseDate: '2026-05-01',
        firstSaleDate: '2026-05-03',
      });
      expect(result.status).toBe('MISSING_PURCHASE_HISTORY');
      expect(result.possibleCause).toContain('Missing historical purchase');
    });

    it('detects missing opening stock when sales precede first receipt', () => {
      const result = resolveReconciliationStatus({
        calculatedStock: dec(-5),
        currentStock: dec(-5),
        difference: dec(0),
        requiredPurchaseQty: dec(0),
        soldQty: dec(5),
        purchasedQty: dec(0),
        openingStock: dec(0),
        firstNegativeDate: '2026-01-01',
        firstPurchaseDate: '2026-02-01',
        firstSaleDate: '2026-01-01',
      });
      expect(result.status).toBe('MISSING_OPENING_STOCK');
    });
  });

  describe('reconcileProduct', () => {
    it('does not hide negative stock', () => {
      const result = reconcileProduct({
        productId: 'p1',
        productName: 'Амортизатор 43×72',
        productCode: 'A4372',
        categoryId: 'c1',
        categoryName: 'Parts',
        openingStock: dec(0),
        purchasedQty: dec(100),
        soldQty: dec(130),
        adjustmentIn: dec(0),
        adjustmentOut: dec(0),
        purchaseAmountKgs: dec(50000),
        salesAmountKgs: dec(80000),
        cogsKgs: dec(65000),
        currentStock: dec(-30),
        movements: [],
      });

      expect(result.calculatedStock.toFixed(3)).toBe('-30.000');
      expect(result.status).toBe('MISSING_PURCHASE_HISTORY');
      expect(result.requiredPurchaseQty.toFixed(3)).toBe('30.000');
    });
  });

  describe('matchesStatusFilter', () => {
    it('filters by status values', () => {
      expect(matchesStatusFilter('OK', 'OK')).toBe(true);
      expect(matchesStatusFilter('NEGATIVE_STOCK', 'OK')).toBe(false);
      expect(matchesStatusFilter('STOCK_MISMATCH', 'ALL')).toBe(true);
      expect(
        matchesStatusFilter('MISSING_PURCHASE_HISTORY', 'MISSING_PURCHASE_HISTORY'),
      ).toBe(true);
    });
  });
});
