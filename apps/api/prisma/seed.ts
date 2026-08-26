import {
  PrismaClient,
  UserRole,
  ClientType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { slugifyCategoryName, uniqueCategorySlug } from '../src/common/slug.util';
import {
  WALK_IN_CUSTOMER_NAME,
  WALK_IN_CUSTOMER_PHONE,
} from '../src/sales/historical-sales-import.logic';
import {
  CATALOG_CATEGORY_NAMES,
  CATALOG_PRODUCTS,
} from './catalog-data';
import {
  DEFAULT_CATEGORY_THRESHOLDS,
  DEFAULT_MARKUP_MATRIX,
} from './pricing-defaults';
import { bootstrapAccountingLedger } from '../src/accounting/accounting.bootstrap';
import { COMPANY_PAYMENT_METHOD_CODES } from '../src/accounting/accounting-codes';

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

async function seedPricingStructure() {
  for (const row of DEFAULT_CATEGORY_THRESHOLDS) {
    await prisma.clientCategoryThreshold.upsert({
      where: { category: row.category },
      update: {
        minPaidAmountKgs: row.minPaidAmountKgs,
        maxPaidAmountKgs: row.maxPaidAmountKgs,
        priority: row.priority,
        isActive: row.isActive,
      },
      create: {
        category: row.category,
        minPaidAmountKgs: row.minPaidAmountKgs,
        maxPaidAmountKgs: row.maxPaidAmountKgs,
        priority: row.priority,
        isActive: row.isActive,
      },
    });
  }

  for (const row of DEFAULT_MARKUP_MATRIX) {
    await prisma.clientTypeCategoryMarkup.upsert({
      where: {
        clientType_category: {
          clientType: row.clientType,
          category: row.category,
        },
      },
      update: { markupPercent: row.markupPercent },
      create: {
        clientType: row.clientType,
        category: row.category,
        markupPercent: row.markupPercent,
      },
    });
  }
}

async function verifyCatalog() {
  const catalogCategoryCount = await prisma.category.count({
    where: { name: { in: [...CATALOG_CATEGORY_NAMES] } },
  });
  if (catalogCategoryCount !== CATALOG_CATEGORY_NAMES.length) {
    throw new Error(`Expected ${CATALOG_CATEGORY_NAMES.length} catalog categories, got ${catalogCategoryCount}`);
  }

  const expectedCodes = CATALOG_PRODUCTS.map((row) => row.code);
  const products = await prisma.product.findMany({
    where: { code: { in: expectedCodes } },
    select: { code: true, name: true },
  });
  const byCode = new Map(products.map((row) => [row.code, row]));
  const missing = CATALOG_PRODUCTS.filter((row) => !byCode.has(row.code));
  if (missing.length > 0) {
    throw new Error(
      `Expected ${CATALOG_PRODUCTS.length} catalog products, missing ${missing
        .map((row) => row.code)
        .join(', ')}`,
    );
  }
  const mismatched = CATALOG_PRODUCTS.filter((row) => byCode.get(row.code)?.name !== row.name);
  if (mismatched.length > 0) {
    throw new Error(
      `Catalog product name mismatch: ${mismatched.map((row) => row.code).join(', ')}`,
    );
  }
}

async function seedSalesOperator() {
  const email = (process.env.SALES_EMAIL ?? 'master@egomot.local').trim().toLowerCase();
  const password = process.env.SALES_PASSWORD ?? process.env.OWNER_PASSWORD ?? 'Owner123!';
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: UserRole.SALES,
      name: 'Бакыт',
    },
    create: {
      email,
      passwordHash,
      name: 'Бакыт',
      role: UserRole.SALES,
    },
  });

  const methods = await prisma.paymentMethod.findMany({
    where: { isActive: true, NOT: { code: { in: [...COMPANY_PAYMENT_METHOD_CODES] } } },
  });
  for (const method of methods) {
    await prisma.paymentAccount.upsert({
      where: {
        userId_paymentMethodId: { userId: user.id, paymentMethodId: method.id },
      },
      update: {},
      create: {
        userId: user.id,
        paymentMethodId: method.id,
        name: `${user.name} — ${method.name}`,
        isActive: true,
      },
    });
  }
}

async function seedWalkInCustomer() {
  const existing = await prisma.client.findFirst({
    where: { name: WALK_IN_CUSTOMER_NAME },
  });
  if (existing) {
    await prisma.client.update({
      where: { id: existing.id },
      data: {
        phone: WALK_IN_CUSTOMER_PHONE,
        clientType: ClientType.RETAIL,
        isActive: true,
      },
    });
    return;
  }

  await prisma.client.create({
    data: {
      name: WALK_IN_CUSTOMER_NAME,
      phone: WALK_IN_CUSTOMER_PHONE,
      clientType: ClientType.RETAIL,
      isActive: true,
    },
  });
}

async function main() {
  await seedOwner();
  await seedSalesOperator();
  await seedWalkInCustomer();
  await bootstrapAccountingLedger(prisma);
  const ownerCount = await prisma.user.count({ where: { role: UserRole.OWNER } });
  const salesCount = await prisma.user.count({ where: { role: UserRole.SALES } });
  // eslint-disable-next-line no-console
  console.log(`Owner ready: ${process.env.OWNER_EMAIL ?? 'owner@egomot.local'} (${ownerCount} OWNER user(s))`);
  // eslint-disable-next-line no-console
  console.log(`Sales operator ready: ${process.env.SALES_EMAIL ?? 'master@egomot.local'} (${salesCount} SALES user(s))`);
  await backfillCategorySlugs();
  await seedCatalog();
  await seedPricingStructure();
  await verifyCatalog();

  // eslint-disable-next-line no-console
  console.log(
    `Seed complete: ${CATALOG_CATEGORY_NAMES.length} catalog categories, ${CATALOG_PRODUCTS.length} catalog products, pricing structure initialized`,
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
