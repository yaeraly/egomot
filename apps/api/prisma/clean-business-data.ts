/**
 * Removes application data while preserving schema/migrations.
 *
 * Usage:
 *   npm run clean:business-data:dry-run     # partial cleanup preview
 *   npm run clean:business-data               # keep users, catalog, pricing
 *   npm run reset:database:dry-run            # full reset preview
 *   npm run reset:database                    # delete ALL application data
 */
import { PrismaClient } from '@prisma/client';
import { CATALOG_PRODUCTS } from './catalog-data';

const prisma = new PrismaClient();

const ALL_TABLE_COUNTS = {
  users: () => prisma.user.count(),
  categories: () => prisma.category.count(),
  products: () => prisma.product.count(),
  suppliers: () => prisma.supplier.count(),
  clients: () => prisma.client.count(),
  purchases: () => prisma.purchase.count(),
  purchaseItems: () => prisma.purchaseItem.count(),
  purchaseReceipts: () => prisma.purchaseReceipt.count(),
  inventory: () => prisma.inventory.count(),
  inventoryMovements: () => prisma.inventoryMovement.count(),
  sales: () => prisma.sale.count(),
  saleItems: () => prisma.saleItem.count(),
  payments: () => prisma.payment.count(),
  financialTransactions: () => prisma.financialTransaction.count(),
  clientDebtTransactions: () => prisma.clientDebtTransaction.count(),
  saleReceipts: () => prisma.saleReceipt.count(),
  saleReturns: () => prisma.saleReturn.count(),
  auditLogs: () => prisma.auditLog.count(),
  productPurchasePriceHistory: () => prisma.productPurchasePriceHistory.count(),
  paymentMethods: () => prisma.paymentMethod.count(),
  paymentAccounts: () => prisma.paymentAccount.count(),
  categoryThresholds: () => prisma.clientCategoryThreshold.count(),
  markupMatrix: () => prisma.clientTypeCategoryMarkup.count(),
} as const;

async function countSnapshot() {
  const entries = await Promise.all(
    Object.entries(ALL_TABLE_COUNTS).map(async ([key, fn]) => [key, await fn()] as const),
  );
  return Object.fromEntries(entries) as Record<keyof typeof ALL_TABLE_COUNTS, number>;
}

function totalRecords(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, n) => sum + n, 0);
}

const PRESERVED_TABLES = [
  'User',
  'Category (catalog categories)',
  'Product (catalog PRD-* codes)',
  'PaymentMethod',
  'PaymentAccount',
  'ClientCategoryThreshold',
  'ClientTypeCategoryMarkup',
] as const;

function catalogProductCodes(): string[] {
  return CATALOG_PRODUCTS.map((row) => row.code);
}

/** Delete transactional data in FK-safe order. */
async function deleteTransactionalData(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) {
  await tx.financialTransaction.deleteMany();
  await tx.clientDebtTransaction.deleteMany();
  await tx.payment.deleteMany();
  await tx.saleReceipt.deleteMany();
  await tx.saleReturn.deleteMany();
  await tx.sale.deleteMany();
  await tx.inventoryMovement.deleteMany();
  await tx.purchaseReceiptDiscrepancy.deleteMany();
  await tx.purchaseReceipt.deleteMany();
  await tx.productPurchasePriceHistory.deleteMany();
  await tx.purchase.deleteMany();
  await tx.inventory.deleteMany();
  await tx.auditLog.deleteMany();
}

async function fullDatabaseReset(dryRun: boolean) {
  const before = await countSnapshot();

  console.log('=== FULL DATABASE RESET ===');
  console.log(JSON.stringify(before, null, 2));
  console.log(`\nTotal records before: ${totalRecords(before)}`);
  console.log('\nWill delete ALL data from every application table (schema preserved).');
  console.log('Delete order respects foreign-key dependencies.');

  if (dryRun) {
    console.log('\nDry run complete — no rows deleted.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await deleteTransactionalData(tx);
    await tx.paymentAccount.deleteMany();
    await tx.client.deleteMany();
    await tx.product.deleteMany();
    await tx.supplier.deleteMany();
    await tx.clientTypeCategoryMarkup.deleteMany();
    await tx.clientCategoryThreshold.deleteMany();
    await tx.paymentMethod.deleteMany();
    await tx.category.deleteMany();
    await tx.user.deleteMany();
  });

  const after = await countSnapshot();
  console.log('\n=== After full reset ===');
  console.log(JSON.stringify(after, null, 2));
  console.log(`\nTotal records after: ${totalRecords(after)}`);

  if (totalRecords(after) !== 0) {
    throw new Error('Full reset incomplete — some records remain.');
  }

  console.log('\nFull database reset complete. Run `npm run prisma:seed` to restore baseline config.');
}

async function cleanBusinessData(dryRun: boolean) {
  const before = await countSnapshot();
  const catalogCodes = catalogProductCodes();

  console.log('=== Database inspection ===');
  console.log(JSON.stringify(before, null, 2));
  console.log('\nPreserved:');
  for (const table of PRESERVED_TABLES) {
    console.log(`  - ${table}`);
  }

  const nonCatalogProducts = await prisma.product.findMany({
    where: { code: { notIn: catalogCodes } },
    select: { id: true, code: true, name: true },
  });

  console.log('\nWill delete (in dependency order):');
  console.log('  1. FinancialTransaction');
  console.log('  2. ClientDebtTransaction');
  console.log('  3. Payment');
  console.log('  4. SaleReceipt');
  console.log('  5. SaleReturn (+ SaleReturnItem cascade)');
  console.log('  6. Sale (+ SaleItem cascade)');
  console.log('  7. InventoryMovement');
  console.log('  8. PurchaseReceiptDiscrepancy');
  console.log('  9. PurchaseReceipt (+ PurchaseReceiptItem cascade)');
  console.log(' 10. ProductPurchasePriceHistory');
  console.log(' 11. Purchase (+ PurchaseItem, PurchaseLogisticsExpense cascade)');
  console.log(' 12. Inventory');
  console.log(' 13. AuditLog');
  console.log(' 14. Client');
  console.log(' 15. Supplier');
  console.log(` 16. Non-catalog products (${nonCatalogProducts.length})`);
  if (nonCatalogProducts.length > 0) {
    for (const product of nonCatalogProducts) {
      console.log(`      - ${product.code}: ${product.name}`);
    }
  }

  if (dryRun) {
    console.log('\nDry run complete — no rows deleted.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    await deleteTransactionalData(tx);
    await tx.client.deleteMany();
    await tx.supplier.deleteMany();

    if (nonCatalogProducts.length > 0) {
      await tx.product.deleteMany({
        where: { code: { notIn: catalogCodes } },
      });
    }
  });

  const after = await countSnapshot();
  console.log('\n=== After cleanup ===');
  console.log(JSON.stringify(after, null, 2));
  console.log('\nCleanup complete.');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const fullReset = process.argv.includes('--full');

  if (fullReset) {
    await fullDatabaseReset(dryRun);
    return;
  }

  await cleanBusinessData(dryRun);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
