import { PrismaClient } from '@prisma/client';
import { InventoryReconciliationService } from '../src/reports/inventory-reconciliation.service';
import { PrismaService } from '../src/prisma/prisma.service';

function formatMoney(value: string): string {
  const n = Number(value);
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

async function main() {
  const prisma = new PrismaClient();
  const service = new InventoryReconciliationService(
    prisma as unknown as PrismaService,
  );

  try {
    const report = await service.inventoryReconciliation({});
    const { summary } = report;

    const hasNegative = summary.negativeStockProducts > 0;
    const hasMismatch = summary.stockMismatches > 0;
    const status =
      !hasNegative && !hasMismatch && summary.missingPurchaseHistory === 0
        ? 'PASS'
        : 'BLOCKED';

    console.log('=== INVENTORY RECONCILIATION ===\n');
    console.log(`Products:                  ${summary.totalProducts}`);
    console.log(`Purchased Qty:             ${summary.totalPurchasedQty}`);
    console.log(`Sold Qty:                  ${summary.totalSoldQty}`);
    console.log(`Current Stock:             ${summary.totalCurrentStock}`);
    console.log('');
    console.log(`Negative Stock Products:   ${summary.negativeStockProducts}`);
    console.log(`Stock Mismatches:          ${summary.stockMismatches}`);
    console.log(
      `Missing Purchase History:  ${summary.missingPurchaseHistory}`,
    );
    console.log('');
    console.log(
      `Sales Amount:              ${formatMoney(summary.totalSalesAmountKgs)} сом`,
    );
    console.log(
      `Purchase Amount:           ${formatMoney(summary.totalPurchaseAmountKgs)} сом`,
    );
    console.log('');
    console.log(`Status:                    ${status}`);
    console.log('');
    console.log('Costing: WAC via sale item unitCostKgs snapshots (FIFO not implemented)');

    const negative = await service.negativeStockReport({});
    const top = negative.products.slice(0, 20);
    if (top.length > 0) {
      console.log('\n=== TOP NEGATIVE STOCK PRODUCTS ===\n');
      for (const row of top) {
        console.log(
          [
            row.productName,
            `Purchased: ${row.purchasedQty}`,
            `Sold: ${row.soldQty}`,
            `Negative: ${row.negativeQty}`,
            `First Negative: ${row.firstNegativeDate ?? '—'}`,
            `Missing Qty: ${row.requiredPurchaseQty}`,
          ].join(' | '),
        );
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
