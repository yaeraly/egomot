import { Prisma } from '@prisma/client';
import { computeInventoryAfterReceipt } from '../purchase-receipts/receipt-calc';

export type LedgerReceiptMovement = {
  productId: string;
  quantity: Prisma.Decimal | string | number;
  unitCost: Prisma.Decimal | string | number;
  transactionDate: Date | null;
  createdAt: Date;
};

export type RebuiltInventorySnapshot = {
  productId: string;
  quantity: string;
  averageUnitCostKgs: string;
  totalValueKgs: string;
};

export function rebuildInventoryFromReceiptMovements(
  movements: LedgerReceiptMovement[],
  productIds: string[],
): RebuiltInventorySnapshot[] {
  const byProduct = new Map<string, LedgerReceiptMovement[]>();
  for (const id of productIds) {
    byProduct.set(id, []);
  }
  for (const movement of movements) {
    const list = byProduct.get(movement.productId) ?? [];
    list.push(movement);
    byProduct.set(movement.productId, list);
  }

  const snapshots: RebuiltInventorySnapshot[] = [];
  for (const [productId, rows] of Array.from(byProduct.entries())) {
    const sorted = [...rows].sort((a, b) => {
      const aTime = (a.transactionDate ?? a.createdAt).getTime();
      const bTime = (b.transactionDate ?? b.createdAt).getTime();
      if (aTime !== bTime) return aTime - bTime;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    let quantity: string | number = 0;
    let totalValueKgs: string | number = 0;
    let averageUnitCostKgs = '0.0000';

    for (const movement of sorted) {
      const next = computeInventoryAfterReceipt({
        currentQuantity: quantity,
        currentTotalValueKgs: totalValueKgs,
        receivedQuantity: String(movement.quantity),
        unitLandedCostKgs: String(movement.unitCost),
      });
      quantity = next.newQuantity.toFixed(3);
      totalValueKgs = next.newTotalValueKgs.toFixed(2);
      averageUnitCostKgs = next.averageUnitCostKgs.toFixed(4);
    }

    snapshots.push({
      productId,
      quantity: typeof quantity === 'number' ? quantity.toFixed(3) : quantity,
      averageUnitCostKgs,
      totalValueKgs:
        typeof totalValueKgs === 'number' ? totalValueKgs.toFixed(2) : totalValueKgs,
    });
  }

  return snapshots;
}
