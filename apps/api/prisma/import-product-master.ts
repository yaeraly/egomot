/**
 * Import product master data from prisma/data/product-master.tsv
 *
 * Usage:
 *   npm run import:product-master:dry-run
 *   npm run import:product-master
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { slugifyCategoryName, uniqueCategorySlug } from '../src/common/slug.util';

const prisma = new PrismaClient();
const DATA_PATH = path.join(__dirname, 'data', 'product-master.tsv');

interface MasterRow {
  lineNumber: number;
  name: string;
  category: string;
  weightKg: string;
  purchasePriceCny: string;
}

function parseRows(): MasterRow[] {
  const content = fs.readFileSync(DATA_PATH, 'utf8');
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const rows: MasterRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split('\t');
    if (parts.length < 4) {
      throw new Error(`Line ${i + 1}: expected 4 tab-separated columns`);
    }
    const [name, category, weightKg, purchasePriceCny] = parts;
    if (!name.trim() || !category.trim()) {
      throw new Error(`Line ${i + 1}: missing name or category`);
    }
    rows.push({
      lineNumber: i + 1,
      name: name.trim(),
      category: category.trim(),
      weightKg: weightKg.trim(),
      purchasePriceCny: purchasePriceCny.trim(),
    });
  }

  const names = rows.map((row) => row.name);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate product names: ${[...new Set(duplicates)].join(', ')}`);
  }

  return rows;
}

function productCode(index: number): string {
  return `PRD-${String(index + 1).padStart(4, '0')}`;
}

async function ensureCategory(name: string) {
  const existing = await prisma.category.findUnique({ where: { name } });
  if (existing) return existing;
  const slug = await uniqueCategorySlug(name, async (candidate) => {
    const row = await prisma.category.findUnique({ where: { slug: candidate } });
    return Boolean(row);
  });
  return prisma.category.create({
    data: { name, slug, isActive: true },
  });
}

async function importProducts(dryRun: boolean) {
  const rows = parseRows();
  const categories = [...new Set(rows.map((row) => row.category))];

  console.log(`Source: ${DATA_PATH}`);
  console.log(`Products to import: ${rows.length}`);
  console.log(`Categories: ${categories.length}`);
  console.log(categories.map((name) => `  - ${name}`).join('\n'));

  if (dryRun) {
    console.log('\nDry run — first 3 rows:');
    for (const row of rows.slice(0, 3)) {
      console.log(`  ${row.name} | ${row.category} | ${row.weightKg} kg | ${row.purchasePriceCny} CNY`);
    }
    console.log('\nDry run complete — no rows written.');
    return;
  }

  let created = 0;
  let updated = 0;

  await prisma.$transaction(async (tx) => {
    for (const categoryName of categories) {
      const existing = await tx.category.findUnique({ where: { name: categoryName } });
      if (!existing) {
        const slug = await uniqueCategorySlug(categoryName, async (candidate) => {
          const row = await tx.category.findUnique({ where: { slug: candidate } });
          return Boolean(row);
        });
        await tx.category.create({
          data: { name: categoryName, slug, isActive: true },
        });
      }
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const category = await tx.category.findUniqueOrThrow({
        where: { name: row.category },
      });
      const code = productCode(i);
      const existing = await tx.product.findUnique({ where: { name: row.name } });

      if (existing) {
        await tx.product.update({
          where: { id: existing.id },
          data: {
            categoryId: category.id,
            unitWeightKg: row.weightKg,
            defaultPurchasePriceCny: row.purchasePriceCny,
            isActive: true,
          },
        });
        updated += 1;
      } else {
        await tx.product.create({
          data: {
            code,
            name: row.name,
            categoryId: category.id,
            unit: 'шт',
            unitWeightKg: row.weightKg,
            defaultPurchasePriceCny: row.purchasePriceCny,
            isActive: true,
          },
        });
        created += 1;
      }
    }
  });

  const productCount = await prisma.product.count();
  const categoryCount = await prisma.category.count();

  console.log('\nImport summary:');
  console.log(`  Created: ${created}`);
  console.log(`  Updated: ${updated}`);
  console.log(`  Total products in DB: ${productCount}`);
  console.log(`  Total categories in DB: ${categoryCount}`);

  if (productCount !== rows.length) {
    throw new Error(`Expected ${rows.length} products after import, found ${productCount}`);
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  await importProducts(dryRun);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
