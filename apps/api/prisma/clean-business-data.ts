/**
 * Removes test/development business data while preserving schema, users,
 * catalog products, payment methods/accounts, and pricing configuration.
 *
 * Usage:
 *   npm run clean:business-data:dry-run
 *   npm run clean:business-data
 */
import { PrismaClient } from '@prisma/client';
import { CATALOG_PRODUCTS } from './catalog-data';

const prisma = new PrismaClient();

const PRESERVED_TABLES = [
  'User',
  'Category (catalog categories)',
  'Product (catalog PRD-* codes)',
  'PaymentMethod',
  'PaymentAccount',
  'ClientCategoryThreshold',
  'ClientTypeCategoryMarkup',
] as const;

async function countSnapshot() {
  return {
    users: await prisma.user.count(),
    categories: await prisma.category.count(),
    products: await prisma.product.count(),
    suppliers: await prisma.supplier.count(),
    clients: await prisma.client.count(),
    purchases: await prisma.purchase.count(),
    purchaseItems: await prisma.purchaseItem.count(),
    purchaseReceipts: await prisma.purchaseReceipt.count(),
    inventory: await prisma.inventory.count(),
    inventoryMovements: await prisma.inventoryMovement.count(),
    sales: await prisma.sale.count(),
    saleItems: await prisma.saleItem.count(),
    payments: await prisma.payment.count(),
    financialTransactions: await prisma.financialTransaction.count(),
    clientDebtTransactions: await prisma.clientDebtTransaction.count(),
    saleReceipts: await prisma.saleReceipt.count(),
    saleReturns: await prisma.saleReturn.count(),
    auditLogs: await prisma.auditLog.count(),
    productPurchasePriceHistory: await prisma.productPurchasePriceHistory.count(),
    paymentMethods: await prisma.paymentMethod.count(),
    paymentAccounts: await prisma.paymentAccount.count(),
    categoryThresholds: await prisma.clientCategoryThreshold.count(),
    markupMatrix: await prisma.clientTypeCategoryMarkup.count(),
  };
}

function catalogProductCodes(): string[] {
  return CATALOG_PRODUCTS.map((row) => row.code);
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
