import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { slugifyCategoryName, uniqueCategorySlug } from '../src/common/slug.util';
import {
  CATALOG_CATEGORY_NAMES,
  CATALOG_PRODUCTS,
} from './catalog-data';

const prisma = new PrismaClient();

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

async function backfillCategorySlugs() {
  const categories = await prisma.category.findMany();
  for (const category of categories) {
    const expected = slugifyCategoryName(category.name);
    if (!category.slug || category.slug.startsWith('category-')) {
      const slug = await uniqueCategorySlug(category.name, async (candidate) => {
        const row = await prisma.category.findFirst({
          where: { slug: candidate, NOT: { id: category.id } },
        });
        return Boolean(row);
      });
      await prisma.category.update({ where: { id: category.id }, data: { slug } });
    } else if (category.slug !== expected && expected) {
      // keep existing slug if already set intentionally
    }
  }
}

async function seedOwner() {
  const email = (process.env.OWNER_EMAIL ?? 'owner@egomot.local').trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD ?? 'Owner123!';
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: UserRole.OWNER,
      name: 'Владелец',
    },
    create: {
      email,
      passwordHash,
      name: 'Владелец',
      role: UserRole.OWNER,
    },
  });
}

async function seedCatalog() {
  for (const name of CATALOG_CATEGORY_NAMES) {
    await ensureCategory(name);
  }

  for (const row of CATALOG_PRODUCTS) {
    const category = await ensureCategory(row.category);
    await prisma.product.upsert({
      where: { name: row.name },
      update: {
        categoryId: category.id,
        unitWeightKg: row.weightKg,
        defaultPurchasePriceCny: row.purchasePriceCny,
        isActive: true,
      },
      create: {
        code: row.code,
        name: row.name,
        categoryId: category.id,
        unit: 'шт',
        unitWeightKg: row.weightKg,
        defaultPurchasePriceCny: row.purchasePriceCny,
        isActive: true,
      },
    });
  }
}

async function verifyCatalog() {
  const catalogCategoryCount = await prisma.category.count({
    where: { name: { in: [...CATALOG_CATEGORY_NAMES] } },
  });
  const catalogProductCount = await prisma.product.count({
    where: { code: { startsWith: 'PRD-' } },
  });
  if (catalogCategoryCount !== CATALOG_CATEGORY_NAMES.length) {
    throw new Error(`Expected ${CATALOG_CATEGORY_NAMES.length} catalog categories, got ${catalogCategoryCount}`);
  }
  if (catalogProductCount !== CATALOG_PRODUCTS.length) {
    throw new Error(`Expected ${CATALOG_PRODUCTS.length} catalog products, got ${catalogProductCount}`);
  }
}

async function main() {
  await seedOwner();
  const ownerCount = await prisma.user.count({ where: { role: UserRole.OWNER } });
  // eslint-disable-next-line no-console
  console.log(`Owner ready: ${process.env.OWNER_EMAIL ?? 'owner@egomot.local'} (${ownerCount} OWNER user(s))`);
  await backfillCategorySlugs();
  await seedCatalog();
  await verifyCatalog();

  // eslint-disable-next-line no-console
  console.log(
    `Seed complete: ${CATALOG_CATEGORY_NAMES.length} catalog categories, ${CATALOG_PRODUCTS.length} catalog products`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
