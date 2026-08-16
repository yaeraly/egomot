import {
  PrismaClient,
  UserRole,
  ClientType,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { slugifyCategoryName, uniqueCategorySlug } from '../src/common/slug.util';
import {
  CATALOG_CATEGORY_NAMES,
  CATALOG_PRODUCTS,
} from './catalog-data';
import {
  DEFAULT_CATEGORY_THRESHOLDS,
  DEFAULT_MARKUP_MATRIX,
} from './pricing-defaults';

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

  const methods = await prisma.paymentMethod.findMany({ where: { isActive: true } });
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

async function seedPaymentMethods() {
  const defaults = [
    { code: 'CASH', name: 'Наличные', sortOrder: 1 },
    { code: 'MBANK', name: 'MBank', sortOrder: 2 },
    { code: 'ELCART', name: 'Элсом', sortOrder: 3 },
    { code: 'ODENGI', name: 'О!Деньги', sortOrder: 4 },
    { code: 'BANK_CARD', name: 'Bank Card', sortOrder: 5 },
    { code: 'OTHER', name: 'Other', sortOrder: 6 },
  ];

  for (const row of defaults) {
    await prisma.paymentMethod.upsert({
      where: { code: row.code },
      update: { name: row.name, sortOrder: row.sortOrder, isActive: true },
      create: {
        code: row.code,
        name: row.name,
        sortOrder: row.sortOrder,
        isActive: true,
      },
    });
  }

  const users = await prisma.user.findMany({ where: { isActive: true } });
  const methods = await prisma.paymentMethod.findMany({ where: { isActive: true } });
  for (const user of users) {
    for (const method of methods) {
      await prisma.paymentAccount.upsert({
        where: {
          userId_paymentMethodId: {
            userId: user.id,
            paymentMethodId: method.id,
          },
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
}

async function seedWalkInCustomer() {
  const existing = await prisma.client.findFirst({
    where: { name: 'Walk-in Customer' },
  });
  if (existing) return existing;

  return prisma.client.create({
    data: {
      name: 'Walk-in Customer',
      phone: 'WALK-IN',
      clientType: ClientType.RETAIL,
      notes: 'System customer for anonymous retail (walk-in) sales',
      isActive: true,
    },
  });
}

async function main() {
  await seedOwner();
  await seedSalesOperator();
  await seedPaymentMethods();
  await seedWalkInCustomer();
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
