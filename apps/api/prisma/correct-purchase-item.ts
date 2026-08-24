/**
 * Correct one purchase item's product assignment without changing costs.
 *
 * Usage (from apps/api):
 *   npm run purchase:correct-item -- ZG-2026-0004
 *   npm run purchase:correct-item -- ZG-2026-0004 --from "Зарядка 60В 58Ач"
 *   npm run purchase:correct-item -- ZG-2026-0004 --confirm
 */
import {
  InventoryMovementType,
  InventoryReferenceType,
  PrismaClient,
  UserRole,
} from '@prisma/client';
import { rebuildInventoryFromLedgerMovements } from '../src/inventory/rebuild-inventory-from-ledger';
import {
  assertUnchangedFinancials,
  DEFAULT_PURCHASE_NUMBER,
  formatProductCorrectionPreview,
  namesMatch,
  PurchaseItemCandidate,
  selectIncorrectPurchaseItem,
  TARGET_PRODUCT_NAME,
} from '../src/purchases/purchase-correct-item.logic';
import { AUDIT_ACTIONS } from '../src/purchases/purchase-audit';

const prisma = new PrismaClient();

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function resolvePurchaseNumber(): string {
  const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  return positional[0] ?? DEFAULT_PURCHASE_NUMBER;
}

async function nextProductCode(): Promise<string> {
  const last = await prisma.product.findFirst({
    where: { code: { startsWith: 'PRD-' } },
    orderBy: { code: 'desc' },
  });
  const match = last?.code.match(/^PRD-(\d+)$/);
  const current = match ? Number(match[1]) : 0;
  return `PRD-${String(current + 1).padStart(4, '0')}`;
}

async function findProductByName(name: string) {
  const products = await prisma.product.findMany({
    select: {
      id: true,
      name: true,
      code: true,
      categoryId: true,
      unit: true,
      unitWeightKg: true,
      defaultPurchasePriceCny: true,
    },
  });
  return products.find((row) => namesMatch(row.name, name)) ?? null;
}

async function rebuildInventory(productIds: string[]) {
  const unique = Array.from(new Set(productIds));
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
  const targetName = argValue('--to') ?? TARGET_PRODUCT_NAME;
  const fromName = argValue('--from');
  const confirmed = process.argv.includes('--confirm');

  const purchase = await prisma.purchase.findUnique({
    where: { number: purchaseNumber },
    include: {
      items: {
        include: { product: true },
        orderBy: { createdAt: 'asc' },
      },
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

  const candidates: PurchaseItemCandidate[] = purchase.items.map((item) => ({
    productId: item.productId,
    productName: item.product.name,
    productCode: item.product.code,
    quantity: item.quantity.toString(),
    unitPriceCny: item.unitPriceCny.toString(),
    unitLandedCostKgs: item.estimatedUnitLandedCostKgs.toString(),
  }));

  const current = selectIncorrectPurchaseItem(candidates, targetName, fromName);
  const purchaseItem = purchase.items.find((item) => item.productId === current.productId)!;

  console.log(
    formatProductCorrectionPreview({
      purchaseNumber,
      current,
      newProductName: targetName,
    }),
  );

  console.log('\n--- All purchase items ---');
  for (const item of candidates) {
    const marker = item.productId === current.productId ? ' ← will change' : '';
    console.log(`${item.productCode} ${item.productName} qty ${item.quantity}${marker}`);
  }

  if (!confirmed) {
    console.log('\n=== PREVIEW ONLY ===');
    console.log('No records were changed.');
    console.log('To apply this product assignment only, run:');
    const fromFlag = fromName ? ` --from "${fromName}"` : '';
    console.log(`  npm run purchase:correct-item -- ${purchaseNumber}${fromFlag} --confirm`);
    return;
  }

  const owner = await prisma.user.findFirst({
    where: { role: UserRole.OWNER, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) {
    throw new Error('No active OWNER user found.');
  }

  const existingTarget = await findProductByName(targetName);
  if (existingTarget && existingTarget.id !== purchaseItem.productId) {
    const alreadyOnPurchase = purchase.items.some((item) => item.productId === existingTarget.id);
    if (alreadyOnPurchase) {
      throw new Error(
        `Purchase already has an item for "${existingTarget.name}". Cannot reassign without merging quantities.`,
      );
    }
  }

  const otherUses = existingTarget
    ? 0
    : await prisma.purchaseItem.count({
        where: {
          productId: purchaseItem.productId,
          NOT: { id: purchaseItem.id },
        },
      });
  const saleUses = existingTarget
    ? 0
    : await prisma.saleItem.count({ where: { productId: purchaseItem.productId } });

  const canRenameInPlace = !existingTarget && otherUses === 0 && saleUses === 0;
  const newProductCode = !existingTarget && !canRenameInPlace ? await nextProductCode() : null;

  const result = await prisma.$transaction(async (tx) => {
    let targetId = existingTarget?.id ?? purchaseItem.productId;
    let targetCreated = false;

    if (canRenameInPlace) {
      await tx.product.update({
        where: { id: purchaseItem.productId },
        data: { name: targetName },
      });
      targetId = purchaseItem.productId;
    } else {
      if (!existingTarget) {
        const created = await tx.product.create({
          data: {
            code: newProductCode!,
            name: targetName,
            categoryId: purchaseItem.product.categoryId,
            unit: purchaseItem.product.unit,
            unitWeightKg: purchaseItem.unitWeightKg,
            defaultPurchasePriceCny: purchaseItem.unitPriceCny,
            isActive: true,
          },
        });
        targetId = created.id;
        targetCreated = true;
      }

      await tx.purchaseItem.update({
        where: { id: purchaseItem.id },
        data: { productId: targetId },
      });

      const receiptItemIds = purchase.receipts.flatMap((receipt) =>
        receipt.items.filter((item) => item.purchaseItemId === purchaseItem.id).map((item) => item.id),
      );
      if (receiptItemIds.length) {
        await tx.purchaseReceiptItem.updateMany({
          where: { id: { in: receiptItemIds } },
          data: { productId: targetId },
        });
      }

      const discrepancyIds = purchase.receipts.flatMap((receipt) =>
        receipt.discrepancies
          .filter((row) => row.productId === purchaseItem.productId)
          .map((row) => row.id),
      );
      if (discrepancyIds.length) {
        await tx.purchaseReceiptDiscrepancy.updateMany({
          where: { id: { in: discrepancyIds } },
          data: { productId: targetId },
        });
      }

      const receiptIds = purchase.receipts.map((receipt) => receipt.id);
      if (receiptIds.length) {
        await tx.inventoryMovement.updateMany({
          where: {
            referenceType: InventoryReferenceType.PURCHASE_RECEIPT,
            referenceId: { in: receiptIds },
            productId: purchaseItem.productId,
          },
          data: { productId: targetId },
        });
      }

      await tx.productPurchasePriceHistory.updateMany({
        where: {
          purchaseId: purchase.id,
          productId: purchaseItem.productId,
        },
        data: { productId: targetId },
      });
    }

    await tx.auditLog.create({
      data: {
        userId: owner.id,
        action: AUDIT_ACTIONS.PURCHASE_EDITED,
        entityType: 'PurchaseItem',
        entityId: purchase.id,
        oldValue: {
          productId: purchaseItem.productId,
          productName: purchaseItem.product.name,
        },
        newValue: {
          productId: targetId,
          productName: targetName,
          quantity: purchaseItem.quantity.toString(),
          unitPriceCny: purchaseItem.unitPriceCny.toString(),
          estimatedUnitLandedCostKgs: purchaseItem.estimatedUnitLandedCostKgs.toString(),
        },
      },
    });

    return { targetId, targetCreated, renamedInPlace: canRenameInPlace };
  });

  if (!result.renamedInPlace) {
    await rebuildInventory([purchaseItem.productId, result.targetId]);
  }

  const updated = await prisma.purchase.findUniqueOrThrow({
    where: { id: purchase.id },
    include: {
      items: { include: { product: true } },
    },
  });
  const updatedItem = updated.items.find((item) => item.id === purchaseItem.id);
  if (!updatedItem) {
    throw new Error('Updated purchase item not found');
  }

  assertUnchangedFinancials({
    before: {
      quantity: purchaseItem.quantity.toString(),
      unitPriceCny: purchaseItem.unitPriceCny.toString(),
      unitLandedCostKgs: purchaseItem.estimatedUnitLandedCostKgs.toString(),
      purchaseTotalKgs: purchase.estimatedTotalLandedCostKgs.toString(),
    },
    after: {
      quantity: updatedItem.quantity.toString(),
      unitPriceCny: updatedItem.unitPriceCny.toString(),
      unitLandedCostKgs: updatedItem.estimatedUnitLandedCostKgs.toString(),
      purchaseTotalKgs: updated.estimatedTotalLandedCostKgs.toString(),
    },
  });

  console.log('\n=== APPLIED ===');
  console.log(`Product assignment: ${purchaseItem.product.name} → ${updatedItem.product.name}`);
  console.log(`Quantity unchanged: ${updatedItem.quantity.toString()}`);
  console.log(`Cost price unchanged: ${updatedItem.estimatedUnitLandedCostKgs.toString()}`);
  console.log(`Purchase total unchanged: ${updated.estimatedTotalLandedCostKgs.toString()}`);
  console.log(`Mode: ${result.renamedInPlace ? 'rename in place' : result.targetCreated ? 'created product + reassigned' : 'reassigned existing product'}`);
  console.log('Status: PASS');
}

main()
  .catch((error) => {
    console.error('BLOCKED:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
