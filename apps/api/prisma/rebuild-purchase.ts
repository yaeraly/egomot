/**
 * Delete and recreate a single purchase with its warehouse receipt(s).
 *
 * Usage (from apps/api):
 *   npm run purchase:rebuild -- ZG-2026-0004
 *   npm run purchase:rebuild -- ZG-2026-0004 --confirm
 *   npm run purchase:rebuild -- ZG-2026-0004 --delete-only --confirm
 *   npm run purchase:rebuild -- ZG-2026-0004 --recreate-only --confirm
 */
import {
  InventoryMovementType,
  InventoryReferenceType,
  Prisma,
  PrismaClient,
  PurchaseReceiptStatus,
  PurchaseStatus,
  UserRole,
} from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import {
  rebuildInventoryFromLedgerMovements,
  RebuiltInventorySnapshot,
} from '../src/inventory/rebuild-inventory-from-ledger';
import {
  productPurchasePriceHistoryValues,
  shouldSyncProductPurchasePrice,
} from '../src/purchases/product-purchase-price.sync';
import {
  compareInventorySnapshots,
  decimalString,
  formatBusinessDate,
  printPurchaseRebuildDetails,
  PurchaseRebuildInventorySnapshot,
  PurchaseRebuildSnapshot,
  PURCHASE_REBUILD_SNAPSHOT_VERSION,
  resolveReceivablePurchaseStatus,
  snapshotPathForPurchase,
} from '../src/purchases/purchase-rebuild.logic';
import { RECEIPT_AUDIT_ACTIONS } from '../src/purchase-receipts/receipt-audit';
import { AUDIT_ACTIONS } from '../src/purchases/purchase-audit';

const prisma = new PrismaClient();

type InventoryRow = {
  productId: string;
  product: { code: string; name: string };
  quantity: Prisma.Decimal;
  averageUnitCostKgs: Prisma.Decimal;
  totalValueKgs: Prisma.Decimal;
};

async function resolveOwnerUser() {
  const owner = await prisma.user.findFirst({
    where: { role: UserRole.OWNER, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) {
    throw new Error('No active OWNER user found. Run prisma seed first.');
  }
  return owner;
}

function purchaseInclude() {
  return {
    supplier: true,
    items: {
      include: { product: true },
      orderBy: { createdAt: 'asc' as const },
    },
    logistics: { orderBy: { createdAt: 'asc' as const } },
    receipts: {
      include: {
        receivedBy: { select: { id: true, name: true } },
        items: { include: { product: true }, orderBy: { createdAt: 'asc' as const } },
        discrepancies: { include: { product: true }, orderBy: { createdAt: 'asc' as const } },
      },
      orderBy: { createdAt: 'asc' as const },
    },
  };
}

async function loadPurchaseByNumber(number: string) {
  return prisma.purchase.findUnique({
    where: { number },
    include: purchaseInclude(),
  });
}

async function loadInventoryForProducts(productIds: string[]): Promise<InventoryRow[]> {
  if (!productIds.length) return [];
  return prisma.inventory.findMany({
    where: { productId: { in: productIds } },
    include: { product: { select: { code: true, name: true } } },
  });
}

function toInventorySnapshot(rows: InventoryRow[]): PurchaseRebuildInventorySnapshot[] {
  return rows.map((row) => ({
    productId: row.productId,
    productCode: row.product.code,
    productName: row.product.name,
    quantity: decimalString(row.quantity),
    averageUnitCostKgs: decimalString(row.averageUnitCostKgs),
    totalValueKgs: decimalString(row.totalValueKgs),
  }));
}

async function buildSnapshot(number: string): Promise<PurchaseRebuildSnapshot> {
  const purchase = await loadPurchaseByNumber(number);
  if (!purchase) {
    throw new Error(`Purchase not found: ${number}`);
  }

  const affectedProductIds = Array.from(
    new Set(purchase.items.map((item) => item.productId)),
  );
  const inventoryBefore = toInventorySnapshot(
    await loadInventoryForProducts(affectedProductIds),
  );

  return {
    version: PURCHASE_REBUILD_SNAPSHOT_VERSION,
    capturedAt: new Date().toISOString(),
    purchase: {
      number: purchase.number,
      supplierId: purchase.supplierId,
      supplierName: purchase.supplier.name,
      status: purchase.status,
      purchaseDate: formatBusinessDate(purchase.purchaseDate),
      exchangeRateCnyToKgs: decimalString(purchase.exchangeRateCnyToKgs),
      notes: purchase.notes,
      totalPositions: purchase.totalPositions,
      totalQuantity: decimalString(purchase.totalQuantity),
      totalWeightKg: decimalString(purchase.totalWeightKg),
      totalPurchaseCny: decimalString(purchase.totalPurchaseCny),
      totalPurchaseCostKgs: decimalString(purchase.totalPurchaseCostKgs),
      totalChinaTransportKgs: decimalString(purchase.totalChinaTransportKgs),
      totalCargoKgs: decimalString(purchase.totalCargoKgs),
      totalKgInternalTransportKgs: decimalString(purchase.totalKgInternalTransportKgs),
      totalOtherLogisticsKgs: decimalString(purchase.totalOtherLogisticsKgs),
      totalLogisticsKgs: decimalString(purchase.totalLogisticsKgs),
      estimatedTotalLandedCostKgs: decimalString(purchase.estimatedTotalLandedCostKgs),
      averageLogisticsCostPerKg: decimalString(purchase.averageLogisticsCostPerKg),
      items: purchase.items.map((item) => ({
        productId: item.productId,
        productCode: item.product.code,
        productName: item.product.name,
        quantity: decimalString(item.quantity),
        unitPriceCny: decimalString(item.unitPriceCny),
        totalCny: decimalString(item.totalCny),
        unitWeightKg: decimalString(item.unitWeightKg),
        totalWeightKg: decimalString(item.totalWeightKg),
        exchangeRateCnyToKgs: decimalString(item.exchangeRateCnyToKgs),
        purchaseCostKgs: decimalString(item.purchaseCostKgs),
        allocatedChinaTransportKgs: decimalString(item.allocatedChinaTransportKgs),
        allocatedCargoKgs: decimalString(item.allocatedCargoKgs),
        allocatedKgInternalTransportKgs: decimalString(item.allocatedKgInternalTransportKgs),
        allocatedOtherLogisticsKgs: decimalString(item.allocatedOtherLogisticsKgs),
        totalAllocatedLogisticsKgs: decimalString(item.totalAllocatedLogisticsKgs),
        estimatedLandedCostKgs: decimalString(item.estimatedLandedCostKgs),
        estimatedUnitLandedCostKgs: decimalString(item.estimatedUnitLandedCostKgs),
      })),
      logistics: purchase.logistics.map((row) => ({
        type: row.type,
        amount: decimalString(row.amount),
        currency: row.currency,
        exchangeRate: row.exchangeRate ? decimalString(row.exchangeRate) : null,
        amountKgs: decimalString(row.amountKgs),
        comment: row.comment,
      })),
    },
    receipts: purchase.receipts.map((receipt) => ({
      number: receipt.number,
      status: receipt.status,
      warehouseReceiptDate: formatBusinessDate(receipt.warehouseReceiptDate) ?? '',
      receivedByUserId: receipt.receivedByUserId,
      receivedByName: receipt.receivedBy.name,
      comment: receipt.comment,
      exchangeRateCnyToKgs: decimalString(receipt.exchangeRateCnyToKgs),
      chinaInternalTransportKgs: decimalString(receipt.chinaInternalTransportKgs),
      cargoKgs: decimalString(receipt.cargoKgs),
      kyrgyzstanInternalTransportKgs: decimalString(receipt.kyrgyzstanInternalTransportKgs),
      totalTransportKgs: decimalString(receipt.totalTransportKgs),
      totalOrderedQuantity: decimalString(receipt.totalOrderedQuantity),
      totalReceivedQuantity: decimalString(receipt.totalReceivedQuantity),
      totalDifference: decimalString(receipt.totalDifference),
      totalLandedCostKgs: decimalString(receipt.totalLandedCostKgs),
      items: receipt.items.map((item) => ({
        productId: item.productId,
        productCode: item.product.code,
        productName: item.product.name,
        orderedQuantity: decimalString(item.orderedQuantity),
        receivedQuantity: decimalString(item.receivedQuantity),
        difference: decimalString(item.difference),
        unitPriceCny: decimalString(item.unitPriceCny),
        unitWeightKg: decimalString(item.unitWeightKg),
        totalWeightKg: decimalString(item.totalWeightKg),
        purchaseCostKgs: decimalString(item.purchaseCostKgs),
        allocatedChinaTransportKgs: decimalString(item.allocatedChinaTransportKgs),
        allocatedCargoKgs: decimalString(item.allocatedCargoKgs),
        allocatedKgInternalTransportKgs: decimalString(item.allocatedKgInternalTransportKgs),
        totalAllocatedTransportKgs: decimalString(item.totalAllocatedTransportKgs),
        unitLandedCostKgs: decimalString(item.unitLandedCostKgs),
        totalLandedCostKgs: decimalString(item.totalLandedCostKgs),
      })),
      discrepancies: receipt.discrepancies.map((row) => ({
        productId: row.productId,
        productCode: row.product.code,
        productName: row.product.name,
        orderedQuantity: decimalString(row.orderedQuantity),
        receivedQuantity: decimalString(row.receivedQuantity),
        difference: decimalString(row.difference),
        type: row.type,
        comment: row.comment,
      })),
    })),
    affectedProductIds,
    inventoryBefore,
  };
}

function saveSnapshot(snapshot: PurchaseRebuildSnapshot, overridePath?: string) {
  const relative = overridePath ?? snapshotPathForPurchase(snapshot.purchase.number);
  const filePath = path.isAbsolute(relative)
    ? relative
    : path.resolve(process.cwd(), relative);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return filePath;
}

function loadSnapshot(filePath: string): PurchaseRebuildSnapshot {
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Snapshot file not found: ${resolved}`);
  }
  const snapshot = JSON.parse(fs.readFileSync(resolved, 'utf8')) as PurchaseRebuildSnapshot;
  if (snapshot.version !== PURCHASE_REBUILD_SNAPSHOT_VERSION) {
    throw new Error(`Unsupported snapshot version: ${snapshot.version}`);
  }
  return snapshot;
}

async function rebuildInventoryForProducts(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  productIds: string[],
): Promise<RebuiltInventorySnapshot[]> {
  const [movements, inventoryRows] = await Promise.all([
    tx.inventoryMovement.findMany({
      where: {
        productId: { in: productIds },
        type: {
          in: [InventoryMovementType.PURCHASE_RECEIPT, InventoryMovementType.SALE],
        },
      },
      select: {
        productId: true,
        type: true,
        quantity: true,
        unitCost: true,
        transactionDate: true,
        createdAt: true,
      },
      orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
    }),
    tx.inventory.findMany({
      where: { productId: { in: productIds } },
      select: { productId: true },
    }),
  ]);

  const allProductIds = Array.from(
    new Set([...productIds, ...inventoryRows.map((row) => row.productId)]),
  );
  const snapshots = rebuildInventoryFromLedgerMovements(movements, allProductIds);

  for (const snapshot of snapshots) {
    await tx.inventory.upsert({
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

async function deletePurchaseData(snapshot: PurchaseRebuildSnapshot) {
  const purchase = await loadPurchaseByNumber(snapshot.purchase.number);
  if (!purchase) {
    throw new Error(`Purchase not found: ${snapshot.purchase.number}`);
  }

  const receiptIds = purchase.receipts.map((row) => row.id);
  const receiptItemIds = purchase.receipts.flatMap((row) => row.items.map((item) => item.id));
  const auditEntityIds = [purchase.id, ...receiptIds, ...receiptItemIds];

  const [saleFinancialTransactions, receiptMovements] = await Promise.all([
    prisma.financialTransaction.count(),
    prisma.inventoryMovement.count({
      where: {
        referenceType: InventoryReferenceType.PURCHASE_RECEIPT,
        referenceId: { in: receiptIds },
      },
    }),
  ]);

  console.log('\n=== DELETE TARGETS ===');
  console.log(`Purchase:                    ${purchase.number}`);
  console.log(`Purchase items:              ${purchase.items.length}`);
  console.log(`Logistics rows:              ${purchase.logistics.length}`);
  console.log(`Warehouse receipts:          ${purchase.receipts.length}`);
  console.log(`Receipt stock movements:     ${receiptMovements}`);
  console.log(
    `Purchase financial txns:     0 (purchases do not create FinancialTransaction rows in the current schema)`,
  );
  console.log(`All financial txns in DB:    ${saleFinancialTransactions} (sales only)`);

  return prisma.$transaction(async (tx) => {
    if (receiptIds.length) {
      await tx.inventoryMovement.deleteMany({
        where: {
          referenceType: InventoryReferenceType.PURCHASE_RECEIPT,
          referenceId: { in: receiptIds },
        },
      });
    }

    await tx.purchaseReceiptDiscrepancy.deleteMany({
      where: { receiptId: { in: receiptIds } },
    });
    await tx.purchaseReceipt.deleteMany({ where: { purchaseId: purchase.id } });
    await tx.productPurchasePriceHistory.deleteMany({
      where: { purchaseId: purchase.id },
    });
    await tx.auditLog.deleteMany({
      where: { entityId: { in: auditEntityIds } },
    });
    await tx.purchase.delete({ where: { id: purchase.id } });

    const rebuilt = await rebuildInventoryForProducts(tx, snapshot.affectedProductIds);
    return rebuilt;
  });
}

async function syncProductPurchasePrices(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  userId: string,
  purchaseId: string,
  items: PurchaseRebuildSnapshot['purchase']['items'],
) {
  for (const item of items) {
    const product = await tx.product.findUniqueOrThrow({
      where: { id: item.productId },
    });
    if (!shouldSyncProductPurchasePrice(product.defaultPurchasePriceCny, item.unitPriceCny)) {
      continue;
    }

    const values = productPurchasePriceHistoryValues(
      product.defaultPurchasePriceCny,
      item.unitPriceCny,
    );

    await tx.productPurchasePriceHistory.create({
      data: {
        productId: item.productId,
        purchaseId,
        previousPriceCny: values.previousPriceCny,
        newPriceCny: values.newPriceCny,
        changedByUserId: userId,
      },
    });

    await tx.product.update({
      where: { id: item.productId },
      data: { defaultPurchasePriceCny: values.defaultPurchasePriceCny },
    });
  }
}

async function recreatePurchase(snapshot: PurchaseRebuildSnapshot) {
  const existing = await loadPurchaseByNumber(snapshot.purchase.number);
  if (existing) {
    throw new Error(
      `Purchase ${snapshot.purchase.number} already exists. Delete it first or use --confirm for a full rebuild.`,
    );
  }

  const owner = await resolveOwnerUser();
  const intermediateStatus = resolveReceivablePurchaseStatus(
    snapshot.purchase.status,
  ) as PurchaseStatus;
  const finalStatus = snapshot.purchase.status as PurchaseStatus;

  return prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: {
        number: snapshot.purchase.number,
        supplierId: snapshot.purchase.supplierId,
        status: intermediateStatus,
        purchaseDate: snapshot.purchase.purchaseDate
          ? new Date(`${snapshot.purchase.purchaseDate}T12:00:00.000Z`)
          : null,
        exchangeRateCnyToKgs: snapshot.purchase.exchangeRateCnyToKgs,
        notes: snapshot.purchase.notes,
        totalPositions: snapshot.purchase.totalPositions,
        totalQuantity: snapshot.purchase.totalQuantity,
        totalWeightKg: snapshot.purchase.totalWeightKg,
        totalPurchaseCny: snapshot.purchase.totalPurchaseCny,
        totalPurchaseCostKgs: snapshot.purchase.totalPurchaseCostKgs,
        totalChinaTransportKgs: snapshot.purchase.totalChinaTransportKgs,
        totalCargoKgs: snapshot.purchase.totalCargoKgs,
        totalKgInternalTransportKgs: snapshot.purchase.totalKgInternalTransportKgs,
        totalOtherLogisticsKgs: snapshot.purchase.totalOtherLogisticsKgs,
        totalLogisticsKgs: snapshot.purchase.totalLogisticsKgs,
        estimatedTotalLandedCostKgs: snapshot.purchase.estimatedTotalLandedCostKgs,
        averageLogisticsCostPerKg: snapshot.purchase.averageLogisticsCostPerKg,
        items: {
          create: snapshot.purchase.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPriceCny: item.unitPriceCny,
            totalCny: item.totalCny,
            unitWeightKg: item.unitWeightKg,
            totalWeightKg: item.totalWeightKg,
            exchangeRateCnyToKgs: item.exchangeRateCnyToKgs,
            purchaseCostKgs: item.purchaseCostKgs,
            allocatedChinaTransportKgs: item.allocatedChinaTransportKgs,
            allocatedCargoKgs: item.allocatedCargoKgs,
            allocatedKgInternalTransportKgs: item.allocatedKgInternalTransportKgs,
            allocatedOtherLogisticsKgs: item.allocatedOtherLogisticsKgs,
            totalAllocatedLogisticsKgs: item.totalAllocatedLogisticsKgs,
            estimatedLandedCostKgs: item.estimatedLandedCostKgs,
            estimatedUnitLandedCostKgs: item.estimatedUnitLandedCostKgs,
          })),
        },
        logistics: {
          create: snapshot.purchase.logistics.map((row) => ({
            type: row.type as never,
            amount: row.amount,
            currency: row.currency as never,
            exchangeRate: row.exchangeRate,
            amountKgs: row.amountKgs,
            comment: row.comment,
          })),
        },
      },
      include: {
        items: true,
      },
    });

    await syncProductPurchasePrices(tx, owner.id, purchase.id, snapshot.purchase.items);

    await tx.auditLog.create({
      data: {
        userId: owner.id,
        action: AUDIT_ACTIONS.PURCHASE_CREATED,
        entityType: 'Purchase',
        entityId: purchase.id,
        newValue: {
          number: purchase.number,
          supplierId: purchase.supplierId,
          status: purchase.status,
        },
      },
    });

    const purchaseItemsByProduct = new Map(
      purchase.items.map((item) => [item.productId, item]),
    );

    for (const receiptSnapshot of snapshot.receipts) {
      const receipt = await tx.purchaseReceipt.create({
        data: {
          number: receiptSnapshot.number,
          purchaseId: purchase.id,
          supplierId: snapshot.purchase.supplierId,
          warehouseReceiptDate: new Date(
            `${receiptSnapshot.warehouseReceiptDate}T12:00:00.000Z`,
          ),
          receivedByUserId: receiptSnapshot.receivedByUserId,
          status: PurchaseReceiptStatus.COMPLETED,
          comment: receiptSnapshot.comment,
          exchangeRateCnyToKgs: receiptSnapshot.exchangeRateCnyToKgs,
          chinaInternalTransportKgs: receiptSnapshot.chinaInternalTransportKgs,
          cargoKgs: receiptSnapshot.cargoKgs,
          kyrgyzstanInternalTransportKgs: receiptSnapshot.kyrgyzstanInternalTransportKgs,
          totalTransportKgs: receiptSnapshot.totalTransportKgs,
          totalOrderedQuantity: receiptSnapshot.totalOrderedQuantity,
          totalReceivedQuantity: receiptSnapshot.totalReceivedQuantity,
          totalDifference: receiptSnapshot.totalDifference,
          totalLandedCostKgs: receiptSnapshot.totalLandedCostKgs,
          items: {
            create: receiptSnapshot.items.map((item) => ({
              purchaseItemId: purchaseItemsByProduct.get(item.productId)!.id,
              productId: item.productId,
              orderedQuantity: item.orderedQuantity,
              receivedQuantity: item.receivedQuantity,
              difference: item.difference,
              unitPriceCny: item.unitPriceCny,
              unitWeightKg: item.unitWeightKg,
              totalWeightKg: item.totalWeightKg,
              purchaseCostKgs: item.purchaseCostKgs,
              allocatedChinaTransportKgs: item.allocatedChinaTransportKgs,
              allocatedCargoKgs: item.allocatedCargoKgs,
              allocatedKgInternalTransportKgs: item.allocatedKgInternalTransportKgs,
              totalAllocatedTransportKgs: item.totalAllocatedTransportKgs,
              unitLandedCostKgs: item.unitLandedCostKgs,
              totalLandedCostKgs: item.totalLandedCostKgs,
            })),
          },
          discrepancies: {
            create: receiptSnapshot.discrepancies.map((row) => ({
              productId: row.productId,
              orderedQuantity: row.orderedQuantity,
              receivedQuantity: row.receivedQuantity,
              difference: row.difference,
              type: row.type as never,
              comment: row.comment,
            })),
          },
        },
        include: { items: true },
      });

      await tx.auditLog.create({
        data: {
          userId: owner.id,
          action: RECEIPT_AUDIT_ACTIONS.RECEIPT_CREATED,
          entityType: 'PurchaseReceipt',
          entityId: receipt.id,
          newValue: {
            number: receipt.number,
            purchaseId: purchase.id,
            purchaseNumber: purchase.number,
            status: receipt.status,
          },
        },
      });

      for (const item of receipt.items) {
        if (Number(item.receivedQuantity) <= 0) continue;

        const existingInventory = await tx.inventory.findUnique({
          where: { productId: item.productId },
        });
        const previousQuantity = existingInventory?.quantity ?? new Prisma.Decimal(0);
        const previousValue = existingInventory?.totalValueKgs ?? new Prisma.Decimal(0);

        await tx.inventoryMovement.create({
          data: {
            type: InventoryMovementType.PURCHASE_RECEIPT,
            productId: item.productId,
            quantity: item.receivedQuantity,
            previousQuantity,
            newQuantity: previousQuantity.plus(item.receivedQuantity),
            unitCost: item.unitLandedCostKgs,
            totalCost: item.totalLandedCostKgs,
            referenceType: InventoryReferenceType.PURCHASE_RECEIPT,
            referenceId: receipt.id,
            userId: owner.id,
            transactionDate: receipt.warehouseReceiptDate,
          },
        });

        await tx.auditLog.create({
          data: {
            userId: owner.id,
            action: RECEIPT_AUDIT_ACTIONS.RECEIPT_ITEM_RECEIVED,
            entityType: 'PurchaseReceiptItem',
            entityId: item.id,
            newValue: {
              productId: item.productId,
              receivedQuantity: decimalString(item.receivedQuantity),
              landedCost: decimalString(item.totalLandedCostKgs),
            },
          },
        });
      }

      await tx.auditLog.create({
        data: {
          userId: owner.id,
          action: RECEIPT_AUDIT_ACTIONS.RECEIPT_COMPLETED,
          entityType: 'PurchaseReceipt',
          entityId: receipt.id,
          newValue: {
            status: PurchaseReceiptStatus.COMPLETED,
            purchaseNumber: purchase.number,
          },
        },
      });
    }

    await rebuildInventoryForProducts(tx, snapshot.affectedProductIds);

    const updatedPurchase = await tx.purchase.update({
      where: { id: purchase.id },
      data: { status: finalStatus },
    });

    return updatedPurchase;
  });
}

function resolvePurchaseNumber(): string {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (!args[0]) {
    throw new Error('Purchase number is required, e.g. ZG-2026-0004');
  }
  return args[0];
}

async function main() {
  const purchaseNumber = resolvePurchaseNumber();
  const confirmed = process.argv.includes('--confirm');
  const deleteOnly = process.argv.includes('--delete-only');
  const recreateOnly = process.argv.includes('--recreate-only');
  const snapshotArgIndex = process.argv.indexOf('--snapshot');
  const snapshotOverride =
    snapshotArgIndex >= 0 ? process.argv[snapshotArgIndex + 1] : undefined;

  if (deleteOnly && recreateOnly) {
    throw new Error('Use only one of --delete-only or --recreate-only');
  }

  let snapshot: PurchaseRebuildSnapshot;
  let snapshotPath: string;

  if (recreateOnly) {
    snapshotPath = snapshotOverride
      ? path.resolve(process.cwd(), snapshotOverride)
      : path.resolve(process.cwd(), snapshotPathForPurchase(purchaseNumber));
    snapshot = loadSnapshot(snapshotPath);
    if (snapshot.purchase.number !== purchaseNumber) {
      throw new Error(
        `Snapshot purchase number ${snapshot.purchase.number} does not match ${purchaseNumber}`,
      );
    }
    printPurchaseRebuildDetails(snapshot);
  } else {
    snapshot = await buildSnapshot(purchaseNumber);
    printPurchaseRebuildDetails(snapshot);
    snapshotPath = saveSnapshot(snapshot, snapshotOverride);
    console.log(`\nSnapshot saved: ${snapshotPath}`);
  }

  if (!confirmed) {
    console.log('\n=== PREVIEW ONLY ===');
    console.log('No records were changed.');
    console.log('To execute, run:');
    if (recreateOnly) {
      console.log(`  npm run purchase:rebuild -- ${purchaseNumber} --recreate-only --confirm`);
    } else if (deleteOnly) {
      console.log(`  npm run purchase:rebuild -- ${purchaseNumber} --delete-only --confirm`);
    } else {
      console.log(`  npm run purchase:rebuild -- ${purchaseNumber} --confirm`);
    }
    return;
  }

  if (!recreateOnly) {
    console.log('\n=== DELETING PURCHASE DATA ===');
    const rebuilt = await deletePurchaseData(snapshot);
    console.log(`Inventory SKUs rebuilt: ${rebuilt.length}`);
    for (const row of rebuilt.filter((item) =>
      snapshot.affectedProductIds.includes(item.productId),
    )) {
      console.log(
        `  ${row.productId}: qty ${row.quantity}, avg ${row.averageUnitCostKgs}, value ${row.totalValueKgs}`,
      );
    }
  }

  if (!deleteOnly) {
    console.log('\n=== RECREATING PURCHASE ===');
    const purchase = await recreatePurchase(snapshot);
    console.log(`Purchase recreated: ${purchase.number} (${purchase.status})`);
    console.log(`Receipts recreated: ${snapshot.receipts.length}`);
  }

  const inventoryAfter = toInventorySnapshot(
    await loadInventoryForProducts(snapshot.affectedProductIds),
  );

  console.log('\n=== VERIFICATION ===');
  if (deleteOnly) {
    console.log('Delete-only mode: inventory was rebuilt without this purchase.');
    console.log('Affected SKUs after delete:');
    for (const row of inventoryAfter) {
      console.log(
        `  ${row.productCode} ${row.productName}: qty ${row.quantity}, value ${row.totalValueKgs} KGS`,
      );
    }
    console.log('Status: PASS');
    return;
  }

  const issues = compareInventorySnapshots(snapshot.inventoryBefore, inventoryAfter);
  if (issues.length === 0) {
    console.log('Inventory balances match the pre-rebuild snapshot.');
    console.log('Status: PASS');
  } else {
    console.log('Inventory discrepancies:');
    for (const issue of issues) {
      console.log(`  ${issue}`);
    }
    console.log('Status: FAILED');
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error('BLOCKED:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
