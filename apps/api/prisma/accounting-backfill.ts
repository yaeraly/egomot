/**
 * Historical finance backfill into Journal / JournalLine.
 *
 * Does not modify Sales, Purchases, or Inventory records.
 * Does not post when projected Inventory 1200 != SUM(Inventory.totalValueKgs).
 * Does not invent opening inventory, supplier AP, cash, or cargo payments.
 * Does not post opening investor capital.
 * Does not convert the 9,167,215 operational wallet into company cash.
 *
 * Usage:
 *   npm run accounting:backfill -- --dry-run
 *   npm run accounting:backfill -- --sales --dry-run
 *   npm run accounting:backfill -- --purchases --dry-run
 *   npm run accounting:backfill -- --payments --dry-run
 *   npm run accounting:backfill -- --cargo --dry-run
 *   npm run accounting:backfill -- --all --dry-run
 *   npm run accounting:backfill -- --all
 */
import { PrismaClient } from '@prisma/client';
import { runHistoricalBackfill } from '../src/accounting/accounting-backfill.runner';

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await runHistoricalBackfill(prisma, process.argv.slice(2));
    console.log(result.report);
    if (!result.dryRun && result.status !== 'PASS') {
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
