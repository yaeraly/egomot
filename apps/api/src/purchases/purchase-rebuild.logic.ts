export const PURCHASE_REBUILD_SNAPSHOT_VERSION = 1;

export interface PurchaseRebuildInventorySnapshot {
  productId: string;
  productCode: string;
  productName: string;
  quantity: string;
  averageUnitCostKgs: string;
  totalValueKgs: string;
}

export interface PurchaseRebuildItemSnapshot {
  productId: string;
  productCode: string;
  productName: string;
  quantity: string;
  unitPriceCny: string;
  totalCny: string;
  unitWeightKg: string;
  totalWeightKg: string;
  exchangeRateCnyToKgs: string;
  purchaseCostKgs: string;
  allocatedChinaTransportKgs: string;
  allocatedCargoKgs: string;
  allocatedKgInternalTransportKgs: string;
  allocatedOtherLogisticsKgs: string;
  totalAllocatedLogisticsKgs: string;
  estimatedLandedCostKgs: string;
  estimatedUnitLandedCostKgs: string;
}

export interface PurchaseRebuildLogisticsSnapshot {
  type: string;
  amount: string;
  currency: string;
  exchangeRate: string | null;
  amountKgs: string;
  comment: string | null;
}

export interface PurchaseRebuildReceiptItemSnapshot {
  productId: string;
  productCode: string;
  productName: string;
  orderedQuantity: string;
  receivedQuantity: string;
  difference: string;
  unitPriceCny: string;
  unitWeightKg: string;
  totalWeightKg: string;
  purchaseCostKgs: string;
  allocatedChinaTransportKgs: string;
  allocatedCargoKgs: string;
  allocatedKgInternalTransportKgs: string;
  totalAllocatedTransportKgs: string;
  unitLandedCostKgs: string;
  totalLandedCostKgs: string;
}

export interface PurchaseRebuildDiscrepancySnapshot {
  productId: string;
  productCode: string;
  productName: string;
  orderedQuantity: string;
  receivedQuantity: string;
  difference: string;
  type: string;
  comment: string | null;
}

export interface PurchaseRebuildReceiptSnapshot {
  number: string;
  status: string;
  warehouseReceiptDate: string;
  receivedByUserId: string;
  receivedByName: string;
  comment: string | null;
  exchangeRateCnyToKgs: string;
  chinaInternalTransportKgs: string;
  cargoKgs: string;
  kyrgyzstanInternalTransportKgs: string;
  totalTransportKgs: string;
  totalOrderedQuantity: string;
  totalReceivedQuantity: string;
  totalDifference: string;
  totalLandedCostKgs: string;
  items: PurchaseRebuildReceiptItemSnapshot[];
  discrepancies: PurchaseRebuildDiscrepancySnapshot[];
}

export interface PurchaseRebuildSnapshot {
  version: typeof PURCHASE_REBUILD_SNAPSHOT_VERSION;
  capturedAt: string;
  purchase: {
    number: string;
    supplierId: string;
    supplierName: string;
    status: string;
    purchaseDate: string | null;
    exchangeRateCnyToKgs: string;
    notes: string | null;
    totalPositions: number;
    totalQuantity: string;
    totalWeightKg: string;
    totalPurchaseCny: string;
    totalPurchaseCostKgs: string;
    totalChinaTransportKgs: string;
    totalCargoKgs: string;
    totalKgInternalTransportKgs: string;
    totalOtherLogisticsKgs: string;
    totalLogisticsKgs: string;
    estimatedTotalLandedCostKgs: string;
    averageLogisticsCostPerKg: string;
    items: PurchaseRebuildItemSnapshot[];
    logistics: PurchaseRebuildLogisticsSnapshot[];
  };
  receipts: PurchaseRebuildReceiptSnapshot[];
  affectedProductIds: string[];
  inventoryBefore: PurchaseRebuildInventorySnapshot[];
}

export function snapshotPathForPurchase(number: string): string {
  const safe = number.replace(/[^A-Za-z0-9._-]+/g, '_');
  return `prisma/data/purchase-snapshots/${safe}.json`;
}

export function decimalString(value: { toString(): string } | string | number | null | undefined): string {
  if (value == null) return '0';
  return String(value);
}

export function formatBusinessDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

export function printPurchaseRebuildDetails(snapshot: PurchaseRebuildSnapshot): void {
  const { purchase, receipts } = snapshot;

  console.log('=== PURCHASE DETAILS ===');
  console.log(`Number:              ${purchase.number}`);
  console.log(`Status:              ${purchase.status}`);
  console.log(`Supplier:            ${purchase.supplierName}`);
  console.log(`Purchase date:       ${purchase.purchaseDate ?? '—'}`);
  console.log(`Exchange rate:       ${purchase.exchangeRateCnyToKgs}`);
  console.log(`Notes:               ${purchase.notes ?? '—'}`);
  console.log('');
  console.log(`Positions:           ${purchase.totalPositions}`);
  console.log(`Total quantity:      ${purchase.totalQuantity}`);
  console.log(`Total weight kg:     ${purchase.totalWeightKg}`);
  console.log(`Purchase CNY:        ${purchase.totalPurchaseCny}`);
  console.log(`Purchase cost KGS:   ${purchase.totalPurchaseCostKgs}`);
  console.log(`Logistics KGS:       ${purchase.totalLogisticsKgs}`);
  console.log(`Landed cost KGS:     ${purchase.estimatedTotalLandedCostKgs}`);

  console.log('\n--- Items ---');
  for (const item of purchase.items) {
    console.log(
      `${item.productCode} ${item.productName}: qty ${item.quantity}, ` +
        `${item.unitPriceCny} CNY, landed ${item.estimatedUnitLandedCostKgs} KGS/unit`,
    );
  }

  if (purchase.logistics.length) {
    console.log('\n--- Logistics ---');
    for (const row of purchase.logistics) {
      console.log(
        `${row.type}: ${row.amount} ${row.currency} = ${row.amountKgs} KGS` +
          (row.comment ? ` (${row.comment})` : ''),
      );
    }
  }

  console.log('\n--- Warehouse receipts ---');
  if (!receipts.length) {
    console.log('No purchase receipts found.');
  }
  for (const receipt of receipts) {
    console.log(`\nReceipt ${receipt.number} [${receipt.status}]`);
    console.log(`Warehouse date:      ${receipt.warehouseReceiptDate}`);
    console.log(`Received by:       ${receipt.receivedByName}`);
    console.log(`Ordered qty:       ${receipt.totalOrderedQuantity}`);
    console.log(`Received qty:      ${receipt.totalReceivedQuantity}`);
    console.log(`Difference:        ${receipt.totalDifference}`);
    console.log(`Landed cost KGS:   ${receipt.totalLandedCostKgs}`);
    for (const item of receipt.items) {
      console.log(
        `  ${item.productCode} ${item.productName}: ordered ${item.orderedQuantity}, ` +
          `received ${item.receivedQuantity}, landed ${item.totalLandedCostKgs} KGS`,
      );
    }
    if (receipt.discrepancies.length) {
      console.log('  Discrepancies:');
      for (const row of receipt.discrepancies) {
        console.log(
          `    ${row.productCode} ${row.productName}: ${row.type} ${row.difference}`,
        );
      }
    }
  }

  console.log('\n--- Inventory before rebuild ---');
  for (const row of snapshot.inventoryBefore) {
    console.log(
      `${row.productCode} ${row.productName}: qty ${row.quantity}, ` +
        `avg cost ${row.averageUnitCostKgs}, value ${row.totalValueKgs} KGS`,
    );
  }
}

export function compareInventorySnapshots(
  expected: PurchaseRebuildInventorySnapshot[],
  actual: PurchaseRebuildInventorySnapshot[],
): string[] {
  const expectedByProduct = new Map(expected.map((row) => [row.productId, row]));
  const actualByProduct = new Map(actual.map((row) => [row.productId, row]));
  const issues: string[] = [];

  for (const [productId, before] of expectedByProduct) {
    const after = actualByProduct.get(productId);
    if (!after) {
      issues.push(`${before.productCode}: missing inventory row after rebuild`);
      continue;
    }
    if (before.quantity !== after.quantity) {
      issues.push(
        `${before.productCode}: quantity ${after.quantity}, expected ${before.quantity}`,
      );
    }
    if (before.averageUnitCostKgs !== after.averageUnitCostKgs) {
      issues.push(
        `${before.productCode}: avg cost ${after.averageUnitCostKgs}, expected ${before.averageUnitCostKgs}`,
      );
    }
    if (before.totalValueKgs !== after.totalValueKgs) {
      issues.push(
        `${before.productCode}: value ${after.totalValueKgs}, expected ${before.totalValueKgs}`,
      );
    }
  }

  return issues;
}

export function resolveReceivablePurchaseStatus(status: string): string {
  if (status === 'RECEIVED' || status === 'RECEIVED_WITH_DISCREPANCY') {
    return 'ARRIVED';
  }
  if (status === 'DRAFT') {
    return 'ORDERED';
  }
  return status;
}
