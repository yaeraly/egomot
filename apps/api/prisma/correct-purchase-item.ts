/**
 * Correct ZG-2026-0004 product assignment and weight.
 *
 * Usage (from apps/api):
 *   npm run purchase:correct-item -- ZG-2026-0004
 *   npm run purchase:correct-item -- ZG-2026-0004 --confirm
 */
import {
  InventoryMovementType,
  InventoryReferenceType,
  Prisma,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { rebuildInventoryFromLedgerMovements } from '../src/inventory/rebuild-inventory-from-ledger';
import { AUDIT_ACTIONS } from '../src/purchases/purchase-audit';
import { dec, roundWeight } from '../src/purchases/purchase-calc';
import {
  DEFAULT_PURCHASE_NUMBER,
  findPurchaseItemByProductName,
  formatProductCorrectionPreview,
  namesMatch,
  PurchaseItemCandidate,
  resolveTargetLineWeight,
  SOURCE_PRODUCT_NAME,
  TARGET_PRODUCT_NAME,
  TARGET_PRODUCT_NOT_FOUND,
  TARGET_UNIT_WEIGHT_KG,
} from '../src/purchases/purchase-correct-item.logic';

const prisma = new PrismaClient();

function resolvePurchaseNumber(): string {
  const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  return positional[0] ?? DEFAULT_PURCHASE_NUMBER;
}

async function findProductByName(name: string) {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      code: true,
      unitWeightKg: true,
    },
  });
  return products.find((row) => namesMatch(row.name, name)) ?? null;
}

async function rebuildInventory(productIds: string[]) {
  const unique = Array.from(new Set(productIds.filter(Boolean)));
  if (!unique.length) return [];

  const movements = await prisma.inventoryMovement.findMany({
    where: {
      productId: { in: unique },
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
  });

  const snapshots = rebuildInventoryFromLedgerMovements(movements, unique);
  for (const snapshot of snapshots) {
    await prisma.inventory.upsert({
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

async function main() {
  const purchaseNumber = resolvePurchaseNumber();
  const confirmed = process.argv.includes('--confirm');

  const purchase = await prisma.purchase.findUnique({
    where: { number: purchaseNumber },
    include: {
      items: {
        include: { product: true },
        orderBy: { createdAt: 'asc' },
      },
      logistics: { orderBy: { createdAt: 'asc' } },
      receipts: {
        include: {
          items: true,
          discrepancies: true,
        },
      },
    },
  });

  if (!purchase) {
    throw new Error(`Purchase not found: ${purchaseNumber}`);
  }

  const targetProduct = await findProductByName(TARGET_PRODUCT_NAME);
  if (!targetProduct) {
    console.error(TARGET_PRODUCT_NOT_FOUND);
    console.error(`Looked for existing product: ${TARGET_PRODUCT_NAME}`);
    process.exit(1);
  }

  const candidates: PurchaseItemCandidate[] = purchase.items.map((item) => ({
    productId: item.productId,
    productName: item.product.name,
    productCode: item.product.code,
    quantity: item.quantity.toString(),
    unitWeightKg: item.unitWeightKg.toString(),
    unitPriceCny: item.unitPriceCny.toString(),
    unitLandedCostKgs: item.estimatedUnitLandedCostKgs.toString(),
  }));

  const sourceItem = findPurchaseItemByProductName(candidates, SOURCE_PRODUCT_NAME);
  const alreadyTarget = findPurchaseItemByProductName(candidates, TARGET_PRODUCT_NAME);
  const current = sourceItem ?? alreadyTarget;

  if (!current) {
    throw new Error(
      `No purchase item uses "${SOURCE_PRODUCT_NAME}" or "${TARGET_PRODUCT_NAME}"`,
    );
  }

  if (sourceItem && alreadyTarget && sourceItem.productId !== alreadyTarget.productId) {
    throw new Error(
      `Purchase already has "${TARGET_PRODUCT_NAME}". Cannot reassign without merging quantities.`,
    );
  }

  const weights = resolveTargetLineWeight(current.quantity, TARGET_UNIT_WEIGHT_KG);
  const currentCargoKgs = purchase.totalCargoKgs.toString();

  console.log(
    formatProductCorrectionPreview({
      purchaseNumber,
      current,
      newProductName: targetProduct.name,
      newUnitWeightKg: weights.unitWeightKg,
      currentCargoKgs,
    }),
  );

  console.log('\n--- Purchase items ---');
  for (const item of candidates) {
    const marker = item.productId === current.productId ? ' ← correct this line' : '';
    console.log(
      `${item.productCode} ${item.productName}: qty ${item.quantity}, weight ${item.unitWeightKg} кг${marker}`,
    );
  }

  if (purchase.logistics.length) {
    console.log('\n--- Logistics ---');
    for (const row of purchase.logistics) {
      console.log(`${row.type}: ${row.amount.toString()} ${row.currency} = ${row.amountKgs.toString()} KGS`);
    }
  }

  if (!confirmed) {
    console.log('\n=== PREVIEW ONLY ===');
    console.log('No records were changed.');
    console.log('To apply name + weight only, run:');
    console.log(`  npm run purchase:correct-item -- ${purchaseNumber} --confirm`);
    return;
  }

  const owner = await prisma.user.findFirst({
    where: { role: UserRole.OWNER, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) {
    throw new Error('No active OWNER user found.');
  }

  const purchaseItem = purchase.items.find((item) => item.productId === current.productId)!;
  const previousProductId = purchaseItem.productId;
  const shouldReassign = previousProductId !== targetProduct.id;

  await prisma.$transaction(async (tx) => {
    if (shouldReassign) {
      await tx.purchaseItem.update({
        where: { id: purchaseItem.id },
        data: {
          productId: targetProduct.id,
          unitWeightKg: weights.unitWeightKg,
          totalWeightKg: weights.totalWeightKg,
        },
      });

      for (const receipt of purchase.receipts) {
        for (const item of receipt.items) {
          if (item.purchaseItemId !== purchaseItem.id) continue;
          const receivedWeights = resolveTargetLineWeight(
            item.receivedQuantity.toString(),
            TARGET_UNIT_WEIGHT_KG,
          );
          await tx.purchaseReceiptItem.update({
            where: { id: item.id },
            data: {
              productId: targetProduct.id,
              unitWeightKg: receivedWeights.unitWeightKg,
              totalWeightKg: receivedWeights.totalWeightKg,
            },
          });
        }
      }

      const discrepancyIds = purchase.receipts.flatMap((receipt) =>
        receipt.discrepancies
          .filter((row) => row.productId === previousProductId)
          .map((row) => row.id),
      );
      if (discrepancyIds.length) {
        await tx.purchaseReceiptDiscrepancy.updateMany({
          where: { id: { in: discrepancyIds } },
          data: { productId: targetProduct.id },
        });
      }

      const receiptIds = purchase.receipts.map((receipt) => receipt.id);
      if (receiptIds.length) {
        await tx.inventoryMovement.updateMany({
          where: {
            referenceType: InventoryReferenceType.PURCHASE_RECEIPT,
            referenceId: { in: receiptIds },
            productId: previousProductId,
          },
          data: { productId: targetProduct.id },
        });
      }

      await tx.productPurchasePriceHistory.updateMany({
        where: {
          purchaseId: purchase.id,
          productId: previousProductId,
        },
        data: { productId: targetProduct.id },
      });
    } else {
      await tx.purchaseItem.update({
        where: { id: purchaseItem.id },
        data: {
          unitWeightKg: weights.unitWeightKg,
          totalWeightKg: weights.totalWeightKg,
        },
      });

      for (const receipt of purchase.receipts) {
        for (const item of receipt.items) {
          if (item.purchaseItemId !== purchaseItem.id) continue;
          const receivedWeights = resolveTargetLineWeight(
            item.receivedQuantity.toString(),
            TARGET_UNIT_WEIGHT_KG,
          );
          await tx.purchaseReceiptItem.update({
            where: { id: item.id },
            data: {
              unitWeightKg: receivedWeights.unitWeightKg,
              totalWeightKg: receivedWeights.totalWeightKg,
            },
          });
        }
      }
    }

    const refreshedItems = await tx.purchaseItem.findMany({
      where: { purchaseId: purchase.id },
      select: { totalWeightKg: true },
    });
    const purchaseTotalWeight = roundWeight(
      refreshedItems.reduce((sum, item) => sum.plus(item.totalWeightKg), dec(0)),
    );
    const averageLogisticsCostPerKg = purchaseTotalWeight.gt(0)
      ? purchase.totalLogisticsKgs.div(purchaseTotalWeight).toDecimalPlaces(4)
      : new Prisma.Decimal(0);

    await tx.purchase.update({
      where: { id: purchase.id },
      data: {
        totalWeightKg: purchaseTotalWeight.toFixed(3),
        averageLogisticsCostPerKg: averageLogisticsCostPerKg.toFixed(4),
      },
    });

    if (targetProduct.unitWeightKg.toString() !== TARGET_UNIT_WEIGHT_KG) {
      await tx.product.update({
        where: { id: targetProduct.id },
        data: { unitWeightKg: TARGET_UNIT_WEIGHT_KG },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: owner.id,
        action: AUDIT_ACTIONS.PURCHASE_EDITED,
        entityType: 'PurchaseItem',
        entityId: purchase.id,
        oldValue: {
          productId: previousProductId,
          productName: purchaseItem.product.name,
          unitWeightKg: purchaseItem.unitWeightKg.toString(),
        },
        newValue: {
          productId: targetProduct.id,
          productName: targetProduct.name,
          unitWeightKg: weights.unitWeightKg,
          totalWeightKg: weights.totalWeightKg,
          cargoUnchanged: purchase.totalCargoKgs.toString(),
        },
      },
    });
  });

  if (shouldReassign) {
    await rebuildInventory([previousProductId, targetProduct.id]);
  }

  const updated = await prisma.purchase.findUniqueOrThrow({
    where: { id: purchase.id },
    include: { items: { include: { product: true } } },
  });
  const updatedItem = updated.items.find((item) => item.id === purchaseItem.id);
  if (!updatedItem) {
    throw new Error('Updated purchase item not found');
  }

  if (!namesMatch(updatedItem.product.name, TARGET_PRODUCT_NAME)) {
    throw new Error(`Product name is ${updatedItem.product.name}, expected ${TARGET_PRODUCT_NAME}`);
  }
  if (updatedItem.unitWeightKg.toString() !== TARGET_UNIT_WEIGHT_KG) {
    throw new Error(
      `Product weight is ${updatedItem.unitWeightKg.toString()}, expected ${TARGET_UNIT_WEIGHT_KG}`,
    );
  }
  if (updated.totalCargoKgs.toString() !== purchase.totalCargoKgs.toString()) {
    throw new Error('Cargo payment changed unexpectedly');
  }
  if (updatedItem.quantity.toString() !== purchaseItem.quantity.toString()) {
    throw new Error('Quantity changed unexpectedly');
  }
  if (updatedItem.unitPriceCny.toString() !== purchaseItem.unitPriceCny.toString()) {
    throw new Error('Purchase price changed unexpectedly');
  }

  console.log('\n=== APPLIED ===');
  console.log(`Product: ${purchaseItem.product.name} → ${updatedItem.product.name}`);
  console.log(`Weight:  ${purchaseItem.unitWeightKg.toString()} → ${updatedItem.unitWeightKg.toString()} кг`);
  console.log(`Cargo:   ${updated.totalCargoKgs.toString()} KGS (unchanged)`);
  console.log(`Used existing product ${targetProduct.code}; no duplicate created.`);
  console.log('Status: PASS');
}

main()
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message === TARGET_PRODUCT_NOT_FOUND ? message : `BLOCKED: ${message}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
