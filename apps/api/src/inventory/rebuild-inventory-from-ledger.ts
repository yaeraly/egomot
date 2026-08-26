import { InventoryMovementType, InventoryReferenceType, Prisma, PurchaseReceiptStatus, SaleStatus } from '@prisma/client';
import { computeInventoryAfterReceipt } from '../purchase-receipts/receipt-calc';
import { computeInventoryAfterSale } from '../sales/sale-calc';

export type LedgerReceiptMovement = {
  productId: string;
  quantity: Prisma.Decimal | string | number;
  unitCost: Prisma.Decimal | string | number;
  transactionDate: Date | null;
  createdAt: Date;
};

export type LedgerMovement = {
  productId: string;
  type: InventoryMovementType;
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

function sortLedgerMovements<T extends { transactionDate: Date | null; createdAt: Date }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    const aTime = (a.transactionDate ?? a.createdAt).getTime();
    const bTime = (b.transactionDate ?? b.createdAt).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
}

function applyLedgerMovement(
  state: { quantity: string | number; totalValueKgs: string | number },
  movement: LedgerMovement,
): RebuiltInventorySnapshot {
  if (movement.type === InventoryMovementType.PURCHASE_RECEIPT) {
    const next = computeInventoryAfterReceipt({
      currentQuantity: state.quantity,
      currentTotalValueKgs: state.totalValueKgs,
      receivedQuantity: String(movement.quantity),
      unitLandedCostKgs: String(movement.unitCost),
    });
    return {
      productId: movement.productId,
      quantity: next.newQuantity.toFixed(3),
      averageUnitCostKgs: next.averageUnitCostKgs.toFixed(4),
      totalValueKgs: next.newTotalValueKgs.toFixed(2),
    };
  }

  if (movement.type === InventoryMovementType.SALE) {
    const next = computeInventoryAfterSale({
      currentQuantity: state.quantity,
      currentTotalValueKgs: state.totalValueKgs,
      soldQuantity: String(movement.quantity),
    });
    return {
      productId: movement.productId,
      quantity: next.newQuantity.toFixed(3),
      averageUnitCostKgs: next.averageUnitCostKgs.toFixed(4),
      totalValueKgs: next.newTotalValueKgs.toFixed(2),
    };
  }

  return {
    productId: movement.productId,
    quantity:
      typeof state.quantity === 'number' ? state.quantity.toFixed(3) : state.quantity,
    averageUnitCostKgs: '0.0000',
    totalValueKgs:
      typeof state.totalValueKgs === 'number'
        ? state.totalValueKgs.toFixed(2)
        : state.totalValueKgs,
  };
}

export function rebuildInventoryFromLedgerMovements(
  movements: LedgerMovement[],
  productIds: string[],
): RebuiltInventorySnapshot[] {
  const byProduct = new Map<string, LedgerMovement[]>();
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
    const sorted = sortLedgerMovements(rows);
    let state: RebuiltInventorySnapshot = {
      productId,
      quantity: '0.000',
      averageUnitCostKgs: '0.0000',
      totalValueKgs: '0.00',
    };

    for (const movement of sorted) {
      state = applyLedgerMovement(state, movement);
    }

    snapshots.push(state);
  }

  return snapshots;
}

export function rebuildInventoryFromReceiptMovements(
  movements: LedgerReceiptMovement[],
  productIds: string[],
): RebuiltInventorySnapshot[] {
  return rebuildInventoryFromLedgerMovements(
    movements.map((movement) => ({
      ...movement,
      type: InventoryMovementType.PURCHASE_RECEIPT,
    })),
    productIds,
  );
}

export async function rebuildInventorySkippingCancelledDocuments(
  db: Prisma.TransactionClient,
  productIds: string[],
) {
  if (productIds.length === 0) return [];

  const movements = await db.inventoryMovement.findMany({
    where: { productId: { in: productIds } },
    orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
  });

  const saleIds = [
    ...new Set(
      movements
        .filter((row) => row.referenceType === InventoryReferenceType.SALE)
        .map((row) => row.referenceId),
    ),
  ];
  const receiptIds = [
    ...new Set(
      movements
        .filter((row) => row.referenceType === InventoryReferenceType.PURCHASE_RECEIPT)
        .map((row) => row.referenceId),
    ),
  ];

  const cancelledSales = saleIds.length
    ? await db.sale.findMany({
        where: { id: { in: saleIds }, status: SaleStatus.CANCELLED },
        select: { id: true },
      })
    : [];
  const cancelledReceipts = receiptIds.length
    ? await db.purchaseReceipt.findMany({
        where: { id: { in: receiptIds }, status: PurchaseReceiptStatus.CANCELLED },
        select: { id: true },
      })
    : [];
  const skipSales = new Set(cancelledSales.map((row) => row.id));
  const skipReceipts = new Set(cancelledReceipts.map((row) => row.id));

  const active = movements.filter((row) => {
    if (row.referenceType === InventoryReferenceType.SALE) {
      return !skipSales.has(row.referenceId);
    }
    if (row.referenceType === InventoryReferenceType.PURCHASE_RECEIPT) {
      return !skipReceipts.has(row.referenceId);
    }
    return true;
  });

  const snapshots = rebuildInventoryFromLedgerMovements(active, productIds);
  for (const snapshot of snapshots) {
    await db.inventory.upsert({
      where: { productId: snapshot.productId },
      update: {
        quantity: snapshot.quantity,
        averageUnitCostKgs: snapshot.averageUnitCostKgs,
        totalValueKgs: snapshot.totalValueKgs,
      },
      create: {
        productId: snapshot.productId,
        quantity: snapshot.quantity,
        averageUnitCostKgs: snapshot.averageUnitCostKgs,
        totalValueKgs: snapshot.totalValueKgs,
      },
    });
  }
  return snapshots;
}
