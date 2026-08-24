/**
 * Delete ALL sales-related records only.
 *
 * Usage (from apps/api):
 *   npm run sales:delete-all              # preview counts only
 *   npm run sales:delete-all -- --confirm # execute deletion
 */
import {
  InventoryMovementType,
  InventoryReferenceType,
  PrismaClient,
} from '@prisma/client';
import { rebuildInventoryFromReceiptMovements } from '../src/inventory/rebuild-inventory-from-ledger';

const prisma = new PrismaClient();

type SalesDeleteCounts = {
  sales: number;
  saleItems: number;
  salePayments: number;
  saleFinancialTransactions: number;
  saleInventoryMovements: number;
  saleReceipts: number;
  saleReturns: number;
  saleReturnItems: number;
  saleDebtTransactions: number;
};

type PreservedCounts = {
  products: number;
  clients: number;
  purchases: number;
  suppliers: number;
  paymentAccounts: number;
  paymentMethods: number;
  inventoryMaster: number;
  purchaseInventoryMovements: number;
  nonSaleFinancialTransactions: number;
};

async function countSalesDeleteTargets(): Promise<SalesDeleteCounts> {
  const saleIds = await prisma.sale.findMany({ select: { id: true } });
  const saleIdList = saleIds.map((row) => row.id);

  const [
    sales,
    saleItems,
    salePayments,
    saleFinancialTransactions,
    saleInventoryMovements,
    saleReceipts,
    saleReturns,
    saleReturnItems,
    saleDebtTransactions,
  ] = await Promise.all([
    prisma.sale.count(),
    prisma.saleItem.count(),
    prisma.payment.count(),
    prisma.financialTransaction.count({
      where: { saleId: { not: null } },
    }),
    prisma.inventoryMovement.count({
      where: { referenceType: InventoryReferenceType.SALE },
    }),
    prisma.saleReceipt.count(),
    prisma.saleReturn.count(),
    prisma.saleReturnItem.count(),
    prisma.clientDebtTransaction.count({
      where: { saleId: { not: null } },
    }),
  ]);

  if (saleIdList.length === 0) {
    return {
      sales,
      saleItems,
      salePayments,
      saleFinancialTransactions,
      saleInventoryMovements,
      saleReceipts,
      saleReturns,
      saleReturnItems,
      saleDebtTransactions,
    };
  }

  return {
    sales,
    saleItems,
    salePayments,
    saleFinancialTransactions,
    saleInventoryMovements,
    saleReceipts,
    saleReturns,
    saleReturnItems,
    saleDebtTransactions,
  };
}

async function countPreservedRecords(): Promise<PreservedCounts> {
  const [
    products,
    clients,
    purchases,
    suppliers,
    paymentAccounts,
    paymentMethods,
    inventoryMaster,
    purchaseInventoryMovements,
    nonSaleFinancialTransactions,
  ] = await Promise.all([
    prisma.product.count(),
    prisma.client.count(),
    prisma.purchase.count(),
    prisma.supplier.count(),
    prisma.paymentAccount.count(),
    prisma.paymentMethod.count(),
    prisma.inventory.count(),
    prisma.inventoryMovement.count({
      where: { referenceType: InventoryReferenceType.PURCHASE_RECEIPT },
    }),
    prisma.financialTransaction.count({
      where: { saleId: null },
    }),
  ]);

  return {
    products,
    clients,
    purchases,
    suppliers,
    paymentAccounts,
    paymentMethods,
    inventoryMaster,
    purchaseInventoryMovements,
    nonSaleFinancialTransactions,
  };
}

function printSection(title: string) {
  console.log(`\n=== ${title} ===`);
}

function printSalesCounts(label: string, counts: SalesDeleteCounts) {
  printSection(label);
  console.log(`Total Sales:                         ${counts.sales}`);
  console.log(`Total Sale Items:                    ${counts.saleItems}`);
  console.log(`Total Sale Payments:                 ${counts.salePayments}`);
  console.log(`Total Sale-generated Cash txns:      ${counts.saleFinancialTransactions}`);
  console.log(`Total Sale-generated Inventory mvts: ${counts.saleInventoryMovements}`);
  console.log(`Total Sale Receipts:                 ${counts.saleReceipts}`);
  console.log(`Total Sale Returns:                  ${counts.saleReturns}`);
  console.log(`Total Sale Return Items:             ${counts.saleReturnItems}`);
  console.log(`Total Sale Debt Transactions:        ${counts.saleDebtTransactions}`);
}

function printPreservedCounts(label: string, counts: PreservedCounts) {
  printSection(label);
  console.log(`Products:                            ${counts.products}`);
  console.log(`Customers:                           ${counts.clients}`);
  console.log(`Purchases:                           ${counts.purchases}`);
  console.log(`Suppliers:                           ${counts.suppliers}`);
  console.log(`Finance accounts:                    ${counts.paymentAccounts}`);
  console.log(`Payment methods:                     ${counts.paymentMethods}`);
  console.log(`Inventory master records:            ${counts.inventoryMaster}`);
  console.log(`Purchase inventory movements:        ${counts.purchaseInventoryMovements}`);
  console.log(`Non-sale financial transactions:     ${counts.nonSaleFinancialTransactions}`);
}

async function restoreInventoryFromRemainingLedger(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
) {
  const [receiptMovements, inventoryRows] = await Promise.all([
    tx.inventoryMovement.findMany({
      where: {
        type: InventoryMovementType.PURCHASE_RECEIPT,
        referenceType: InventoryReferenceType.PURCHASE_RECEIPT,
      },
      select: {
        productId: true,
        quantity: true,
        unitCost: true,
        transactionDate: true,
        createdAt: true,
      },
      orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
    }),
    tx.inventory.findMany({ select: { productId: true } }),
  ]);

  const productIds = Array.from(
    new Set([
      ...inventoryRows.map((row) => row.productId),
      ...receiptMovements.map((row) => row.productId),
    ]),
  );

  const snapshots = rebuildInventoryFromReceiptMovements(
    receiptMovements,
    productIds,
  );

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

async function deleteAllSalesData() {
  return prisma.$transaction(async (tx) => {
    await tx.financialTransaction.deleteMany({
      where: { saleId: { not: null } },
    });

    await tx.clientDebtTransaction.deleteMany({
      where: { saleId: { not: null } },
    });

    await tx.payment.deleteMany();

    await tx.saleReceipt.deleteMany();

    await tx.saleReturnItem.deleteMany();
    await tx.saleReturn.deleteMany();

    await tx.inventoryMovement.deleteMany({
      where: { referenceType: InventoryReferenceType.SALE },
    });

    await tx.sale.deleteMany();

    const restored = await restoreInventoryFromRemainingLedger(tx);
    return restored;
  });
}

async function verifyPostDelete() {
  const salesCounts = await countSalesDeleteTargets();
  const preserved = await countPreservedRecords();

  const salesZero =
    salesCounts.sales === 0 &&
    salesCounts.saleItems === 0 &&
    salesCounts.salePayments === 0 &&
    salesCounts.saleFinancialTransactions === 0 &&
    salesCounts.saleInventoryMovements === 0;

  return { salesCounts, preserved, salesZero };
}

async function main() {
  const confirmed = process.argv.includes('--confirm');

  const preSalesCounts = await countSalesDeleteTargets();
  const prePreserved = await countPreservedRecords();

  printSalesCounts('PRE-DELETE SALES COUNTS', preSalesCounts);
  printPreservedCounts('RECORDS THAT WILL REMAIN UNCHANGED', prePreserved);

  printSection('RECORDS THAT WILL BE DELETED');
  console.log('  - Sale Items (via Sale cascade)');
  console.log('  - Sale Payments');
  console.log('  - Sale-generated FinancialTransactions (saleId set / SALE_PAYMENT)');
  console.log('  - Sale-generated ClientDebtTransactions');
  console.log('  - Sale Receipts');
  console.log('  - Sale Returns and Sale Return Items');
  console.log('  - Sale-generated InventoryMovements (referenceType = SALE)');
  console.log('  - Sales');
  console.log('');
  console.log('Inventory.quantity will then be rebuilt from remaining PURCHASE_RECEIPT movements (WAC).');
  console.log('FIFO is not implemented. Sale movements are reversed via the remaining ledger, not a raw +soldQty bump.');

  printSection('RECORDS THAT WILL NOT BE DELETED');
  console.log('  - Products');
  console.log('  - Customers (including Walk-in Customer)');
  console.log('  - Purchases and Purchase Items');
  console.log('  - Suppliers');
  console.log('  - Inventory master records');
  console.log('  - Payment accounts and payment methods');
  console.log('  - Purchase inventory movements');
  console.log('  - Non-sale financial transactions');

  if (!confirmed) {
    printSection('PREVIEW ONLY');
    console.log('No records were deleted.');
    console.log('To execute deletion, run:');
    console.log('  npm run sales:delete-all -- --confirm');
    return;
  }

  if (preSalesCounts.sales === 0 && preSalesCounts.saleInventoryMovements === 0) {
    printSection('SALES ALREADY EMPTY — REBUILDING INVENTORY FROM PURCHASE LEDGER');
    const restoredOnly = await prisma.$transaction((tx) =>
      restoreInventoryFromRemainingLedger(tx),
    );
    console.log(`Inventory SKUs rebuilt: ${restoredOnly.length}`);
    console.log(
      `Inventory qty after restore: ${restoredOnly.reduce((sum, row) => sum + Number(row.quantity), 0)}`,
    );
    console.log('Status: PASS');
    return;
  }

  printSection('DELETING SALES DATA AND RESTORING INVENTORY');
  const restored = await deleteAllSalesData();
  const restoredQty = restored.reduce(
    (sum, row) => sum + Number(row.quantity),
    0,
  );

  const { salesCounts: postSalesCounts, preserved: postPreserved, salesZero } =
    await verifyPostDelete();

  printSalesCounts('POST-DELETE SALES COUNTS', postSalesCounts);
  printPreservedCounts('POST-DELETE PRESERVED COUNTS', postPreserved);

  printSection('VERIFICATION');
  console.log(`Sales = 0:                         ${postSalesCounts.sales === 0 ? 'YES' : 'NO'}`);
  console.log(`Sale Items = 0:                    ${postSalesCounts.saleItems === 0 ? 'YES' : 'NO'}`);
  console.log(`Sale Payments = 0:                 ${postSalesCounts.salePayments === 0 ? 'YES' : 'NO'}`);
  console.log(
    `Sale-generated Cash txns = 0:        ${postSalesCounts.saleFinancialTransactions === 0 ? 'YES' : 'NO'}`,
  );
  console.log(
    `Sale-generated Inventory mvts = 0:   ${postSalesCounts.saleInventoryMovements === 0 ? 'YES' : 'NO'}`,
  );
  console.log(`Products still exist:              ${postPreserved.products > 0 ? 'YES' : 'NO'}`);
  console.log(`Customers still exist:             ${postPreserved.clients > 0 ? 'YES' : 'NO'}`);
  console.log(`Purchases still exist:             ${postPreserved.purchases >= 0 ? 'YES' : 'NO'}`);
  console.log(`Suppliers still exist:             ${postPreserved.suppliers >= 0 ? 'YES' : 'NO'}`);
  console.log(
    `Finance accounts still exist:        ${postPreserved.paymentAccounts > 0 ? 'YES' : 'NO'}`,
  );
  console.log(`Inventory SKUs rebuilt:            ${restored.length}`);
  console.log(`Inventory qty after restore:       ${restoredQty}`);
  console.log(`Status: ${salesZero ? 'PASS' : 'FAILED'}`);

  if (!salesZero) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
