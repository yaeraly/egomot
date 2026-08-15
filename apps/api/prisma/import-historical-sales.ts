/**
 * One-off importer for historical sales spreadsheet data.
 *
 * Usage:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/import-historical-sales.ts [--dry-run]
 */
import {
  ClientPricingCategory,
  ClientType,
  FinancialTransactionType,
  InventoryMovementType,
  InventoryReferenceType,
  Prisma,
  PrismaClient,
  SalePaymentStatus,
  SaleStatus,
  UserRole,
} from '@prisma/client';
import Decimal from 'decimal.js';
import * as fs from 'fs';
import * as path from 'path';
import { dec, roundMoney, roundQty, roundUnitCost } from '../src/purchases/purchase-calc';
import { findMatrixMarkup, roundMarkup } from '../src/pricing/pricing-calc';

const prisma = new PrismaClient();

const DATA_PATH = path.join(__dirname, 'data', 'historical-sales.tsv');

const PRODUCT_ALIASES: Record<string, string> = {
  'Аккумулятор 58Ач': 'Chaowei Аккумулятор 58 Ач',
};

const SKIP_PRODUCTS = new Set(['Товар']);

const DEFAULT_IMPORT_CATEGORY = 'Аксессуары';

interface RawRow {
  lineNumber: number;
  dateStr: string;
  phone: string;
  productName: string;
  quantityStr: string;
  unitPriceStr: string;
}

interface ParsedRow {
  lineNumber: number;
  saleDate: Date;
  phone: string;
  phoneDigits: string;
  productName: string;
  quantity: Decimal;
  unitPriceKgs: Decimal;
}

interface ValidationIssue {
  lineNumber: number;
  message: string;
  row?: RawRow;
}

interface SaleGroup {
  key: string;
  saleDate: Date;
  phone: string;
  phoneDigits: string;
  items: ParsedRow[];
}

function normalizePhoneDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

function parseMoney(value: string): Decimal | null {
  const trimmed = value.trim().replace(/,/g, '');
  if (!trimmed) return null;
  const n = dec(trimmed);
  return n.isNaN() ? null : n;
}

function parseQuantity(value: string): Decimal | null {
  const trimmed = value.trim().replace(/,/g, '');
  if (!trimmed) return null;
  const n = dec(trimmed);
  return n.isNaN() ? null : n;
}

function parseSaleDate(dateStr: string): Date | null {
  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) return null;
  const month = Number(parts[0]);
  const day = Number(parts[1]);
  const year = Number(parts[2]);
  if (!month || !day || !year) return null;
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function parseTsv(content: string): RawRow[] {
  const lines = content.split(/\r?\n/);
  const rows: RawRow[] = [];
  let lineNumber = 0;

  for (const line of lines) {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (
      trimmed.startsWith('ДАТА') ||
      trimmed.includes('КОЛИЧ') ||
      trimmed.includes('ЦЕНА')
    ) {
      continue;
    }

    const parts = line.split('\t');
    if (parts.length < 5) {
      continue;
    }

    rows.push({
      lineNumber,
      dateStr: parts[0].trim(),
      phone: parts[1].trim(),
      productName: parts[2].trim(),
      quantityStr: parts[3].trim(),
      unitPriceStr: parts[4].trim(),
    });
  }

  return rows;
}

function validateAndParseRows(rawRows: RawRow[]): {
  parsed: ParsedRow[];
  issues: ValidationIssue[];
} {
  const parsed: ParsedRow[] = [];
  const issues: ValidationIssue[] = [];

  for (const row of rawRows) {
    if (!row.dateStr) {
      issues.push({ lineNumber: row.lineNumber, message: 'Missing date', row });
      continue;
    }
    if (!row.phone) {
      issues.push({ lineNumber: row.lineNumber, message: 'Missing client phone', row });
      continue;
    }
    if (!row.productName) {
      issues.push({ lineNumber: row.lineNumber, message: 'Missing product name', row });
      continue;
    }
    if (SKIP_PRODUCTS.has(row.productName)) {
      issues.push({
        lineNumber: row.lineNumber,
        message: `Skipped placeholder product "${row.productName}"`,
        row,
      });
      continue;
    }

    const saleDate = parseSaleDate(row.dateStr);
    if (!saleDate) {
      issues.push({
        lineNumber: row.lineNumber,
        message: `Invalid date "${row.dateStr}"`,
        row,
      });
      continue;
    }

    const quantity = parseQuantity(row.quantityStr);
    if (quantity === null || quantity.lte(0)) {
      issues.push({
        lineNumber: row.lineNumber,
        message: `Invalid or missing quantity "${row.quantityStr}"`,
        row,
      });
      continue;
    }

    const unitPriceKgs = parseMoney(row.unitPriceStr);
    if (unitPriceKgs === null || unitPriceKgs.lte(0)) {
      issues.push({
        lineNumber: row.lineNumber,
        message: `Invalid or missing unit price "${row.unitPriceStr}"`,
        row,
      });
      continue;
    }

    const phoneDigits = normalizePhoneDigits(row.phone);
    if (phoneDigits.length < 9) {
      issues.push({
        lineNumber: row.lineNumber,
        message: `Invalid phone "${row.phone}"`,
        row,
      });
      continue;
    }

    parsed.push({
      lineNumber: row.lineNumber,
      saleDate,
      phone: row.phone,
      phoneDigits,
      productName: row.productName,
      quantity: roundQty(quantity),
      unitPriceKgs: roundMoney(unitPriceKgs),
    });
  }

  return { parsed, issues };
}

function groupSales(rows: ParsedRow[]): SaleGroup[] {
  const map = new Map<string, SaleGroup>();

  for (const row of rows) {
    const dateKey = row.saleDate.toISOString().slice(0, 10);
    const key = `${dateKey}|${row.phoneDigits}`;
    const existing = map.get(key);
    if (existing) {
      existing.items.push(row);
    } else {
      map.set(key, {
        key,
        saleDate: row.saleDate,
        phone: row.phone,
        phoneDigits: row.phoneDigits,
        items: [row],
      });
    }
  }

  return [...map.values()].sort(
    (a, b) => a.saleDate.getTime() - b.saleDate.getTime(),
  );
}

function computeHistoricalInventoryAfterSale(params: {
  currentQuantity: Decimal.Value;
  currentTotalValueKgs: Decimal.Value;
  soldQuantity: Decimal.Value;
}) {
  const prevQty = roundQty(params.currentQuantity);
  const soldQty = roundQty(params.soldQuantity);
  const prevValue = roundMoney(params.currentTotalValueKgs);

  const avgCost = prevQty.gt(0)
    ? roundUnitCost(prevValue.div(prevQty))
    : roundUnitCost(0);
  const removedValue = roundMoney(soldQty.times(avgCost));
  const newQty = roundQty(prevQty.minus(soldQty));
  const newValue = roundMoney(prevValue.minus(removedValue));

  return {
    previousQuantity: prevQty,
    newQuantity: newQty,
    unitCost: avgCost,
    totalCost: removedValue,
    newTotalValueKgs: newValue,
    averageUnitCostKgs: newQty.gt(0)
      ? roundUnitCost(newValue.div(newQty))
      : roundUnitCost(0),
  };
}

async function nextSaleNumber(tx: Prisma.TransactionClient): Promise<string> {
  const rows = await tx.sale.findMany({
    where: { number: { startsWith: 'S-' } },
    select: { number: true },
  });
  let max = 0;
  for (const row of rows) {
    const match = row.number.match(/^S-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `S-${String(max + 1).padStart(5, '0')}`;
}

async function resolveOwnerUser() {
  const owner = await prisma.user.findFirst({
    where: { role: UserRole.OWNER, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!owner) {
    throw new Error('No active OWNER user found. Run prisma seed first.');
  }
  return owner;
}

async function resolveCashAccount(userId: string, userName: string) {
  let account = await prisma.paymentAccount.findFirst({
    where: {
      userId,
      isActive: true,
      paymentMethod: { code: 'CASH', isActive: true },
    },
    include: { paymentMethod: true },
  });
  if (!account) {
    const cashMethod = await prisma.paymentMethod.findFirst({
      where: { code: 'CASH', isActive: true },
    });
    if (!cashMethod) {
      throw new Error('CASH payment method not found. Run prisma migrate deploy first.');
    }
    account = await prisma.paymentAccount.create({
      data: {
        userId,
        paymentMethodId: cashMethod.id,
        name: `${userName} — ${cashMethod.name}`,
        isActive: true,
      },
      include: { paymentMethod: true },
    });
  }
  return account;
}

async function buildLookups() {
  const products = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, name: true, baseMarkupPercent: true },
  });
  const productByName = new Map(products.map((p) => [p.name, p]));

  const clients = await prisma.client.findMany({
    select: { id: true, phone: true, name: true, clientType: true },
  });
  const clientByPhoneDigits = new Map<string, (typeof clients)[number]>();
  for (const client of clients) {
    clientByPhoneDigits.set(normalizePhoneDigits(client.phone), client);
  }

  const matrix = await prisma.clientTypeCategoryMarkup.findMany();
  const categoryThresholds = await prisma.clientCategoryThreshold.findMany({
    where: { isActive: true },
    orderBy: { priority: 'asc' },
  });

  return { productByName, clientByPhoneDigits, matrix, categoryThresholds };
}

function resolveProductName(name: string): string {
  return PRODUCT_ALIASES[name] ?? name;
}

async function ensureImportProduct(
  name: string,
  productByName: Map<
    string,
    { id: string; name: string; baseMarkupPercent: Prisma.Decimal | null }
  >,
  dryRun: boolean,
) {
  const canonicalName = resolveProductName(name);
  const existing = productByName.get(canonicalName);
  if (existing) return existing;

  if (dryRun) {
    const placeholder = {
      id: `dry-product-${canonicalName}`,
      name: canonicalName,
      baseMarkupPercent: null,
    };
    productByName.set(canonicalName, placeholder);
    return placeholder;
  }

  const category = await prisma.category.findFirst({
    where: { name: DEFAULT_IMPORT_CATEGORY },
  });
  if (!category) {
    throw new Error(`Category "${DEFAULT_IMPORT_CATEGORY}" not found`);
  }

  const count = await prisma.product.count({
    where: { code: { startsWith: 'HIST-' } },
  });
  const code = `HIST-${String(count + 1).padStart(4, '0')}`;

  const created = await prisma.product.create({
    data: {
      code,
      name: canonicalName,
      categoryId: category.id,
      unit: 'шт',
      unitWeightKg: '1.000',
      isActive: true,
    },
    select: { id: true, name: true, baseMarkupPercent: true },
  });

  productByName.set(canonicalName, created);
  console.log(`Created missing product: ${canonicalName} (${code})`);
  return created;
}

async function resolveClient(
  phone: string,
  phoneDigits: string,
  clientByPhoneDigits: Map<
    string,
    { id: string; phone: string; name: string; clientType: ClientType }
  >,
  dryRun: boolean,
) {
  const existing = clientByPhoneDigits.get(phoneDigits);
  if (existing) return existing;

  if (dryRun) {
    return {
      id: `dry-${phoneDigits}`,
      phone,
      name: phone,
      clientType: ClientType.RETAIL,
    };
  }

  const created = await prisma.client.create({
    data: {
      name: phone,
      phone,
      clientType: ClientType.RETAIL,
      isActive: true,
    },
  });
  clientByPhoneDigits.set(phoneDigits, created);
  return created;
}

function defaultClientCategory(): ClientPricingCategory {
  return ClientPricingCategory.STANDARD;
}

function resolveClientMarkup(
  clientType: ClientType,
  category: ClientPricingCategory,
  matrix: Array<{
    clientType: ClientType;
    category: ClientPricingCategory;
    markupPercent: Prisma.Decimal;
  }>,
) {
  return findMatrixMarkup(
    matrix.map((row) => ({
      clientType: row.clientType,
      category: row.category,
      markupPercent: row.markupPercent,
    })),
    clientType,
    category,
  );
}

async function resolveUnitCost(productId: string): Promise<Decimal> {
  if (productId.startsWith('dry-')) return dec(0);
  const inventory = await prisma.inventory.findUnique({ where: { productId } });
  if (inventory && inventory.averageUnitCostKgs.gt(0)) {
    return inventory.averageUnitCostKgs;
  }
  return dec(0);
}

async function resolveImportProduct(
  productName: string,
  productByName: Map<
    string,
    { id: string; name: string; baseMarkupPercent: Prisma.Decimal | null }
  >,
  dryRun: boolean,
) {
  const canonicalName = resolveProductName(productName);
  const existing = productByName.get(canonicalName);
  if (existing) return existing;
  return ensureImportProduct(productName, productByName, dryRun);
}

async function importSaleGroup(
  group: SaleGroup,
  ctx: {
    owner: { id: string };
    cashAccount: { id: string; paymentMethodId: string };
    productByName: Map<
      string,
      { id: string; name: string; baseMarkupPercent: Prisma.Decimal | null }
    >;
    clientByPhoneDigits: Map<
      string,
      { id: string; phone: string; name: string; clientType: ClientType }
    >;
    matrix: Array<{
      clientType: ClientType;
      category: ClientPricingCategory;
      markupPercent: Prisma.Decimal;
    }>;
    dryRun: boolean;
  },
) {
  const idempotencyKey = `historical-${group.key}`;

  const existing = await prisma.sale.findUnique({
    where: { idempotencyKey },
  });
  if (existing) {
    return { skipped: true, reason: 'already imported', saleNumber: existing.number };
  }

  const client = await resolveClient(
    group.phone,
    group.phoneDigits,
    ctx.clientByPhoneDigits,
    ctx.dryRun,
  );

  const clientCategory = defaultClientCategory();
  const clientMarkupPercent = resolveClientMarkup(
    client.clientType,
    clientCategory,
    ctx.matrix,
  );

  const pricedItems: Array<{
    productId: string;
    productName: string;
    quantity: Decimal;
    unitPriceKgs: Decimal;
    lineTotalKgs: Decimal;
    unitCostKgs: Decimal;
    baseMarkupPercent: Decimal;
    clientMarkupPercent: Decimal;
    finalMarkupPercent: Decimal;
  }> = [];

  for (const item of group.items) {
    const product = await resolveImportProduct(
      item.productName,
      ctx.productByName,
      ctx.dryRun,
    );

    const unitCostKgs = await resolveUnitCost(product.id);
    const unitPriceKgs = item.unitPriceKgs;
    const finalMarkupPercent = unitCostKgs.gt(0)
      ? roundMarkup(unitPriceKgs.div(unitCostKgs).minus(1).times(100))
      : roundMarkup(
          dec(product.baseMarkupPercent ?? 0).plus(clientMarkupPercent),
        );
    const lineTotalKgs = roundMoney(unitPriceKgs.times(item.quantity));

    pricedItems.push({
      productId: product.id,
      productName: product.name,
      quantity: item.quantity,
      unitPriceKgs,
      lineTotalKgs,
      unitCostKgs,
      baseMarkupPercent: dec(product.baseMarkupPercent ?? 0),
      clientMarkupPercent,
      finalMarkupPercent,
    });
  }

  const totalAmountKgs = roundMoney(
    pricedItems.reduce((sum, row) => sum.plus(row.lineTotalKgs), dec(0)),
  );

  if (ctx.dryRun) {
    return {
      skipped: false,
      dryRun: true,
      saleNumber: '(dry-run)',
      clientPhone: group.phone,
      itemCount: pricedItems.length,
      totalAmountKgs: totalAmountKgs.toFixed(2),
    };
  }

  return prisma.$transaction(async (tx) => {
    const number = await nextSaleNumber(tx);
    const saleDate = group.saleDate;

    const sale = await tx.sale.create({
      data: {
        number,
        idempotencyKey,
        clientId: client.id,
        soldByUserId: ctx.owner.id,
        createdByUserId: ctx.owner.id,
        confirmedByUserId: ctx.owner.id,
        clientTypeAtSale: client.clientType,
        clientCategoryAtSale: clientCategory,
        status: SaleStatus.CONFIRMED,
        paymentStatus: SalePaymentStatus.PAID,
        saleDate,
        totalAmountKgs,
        paidAmountKgs: totalAmountKgs,
        debtAmountKgs: 0,
        fullyPaidAt: saleDate,
        confirmedAt: saleDate,
        items: {
          create: pricedItems.map((row) => ({
            productId: row.productId,
            quantity: row.quantity.toFixed(3),
            unitCostKgs: row.unitCostKgs.toFixed(4),
            unitPriceKgs: row.unitPriceKgs.toFixed(4),
            lineTotalKgs: row.lineTotalKgs.toFixed(2),
            baseMarkupPercent: row.baseMarkupPercent.toFixed(4),
            clientMarkupPercent: row.clientMarkupPercent.toFixed(4),
            finalMarkupPercent: row.finalMarkupPercent.toFixed(4),
            clientTypeAtSale: client.clientType,
            clientCategoryAtSale: clientCategory,
          })),
        },
      },
    });

    for (const row of pricedItems) {
      let inventory = await tx.inventory.findUnique({
        where: { productId: row.productId },
      });
      if (!inventory) {
        inventory = await tx.inventory.create({
          data: {
            productId: row.productId,
            quantity: '0',
            averageUnitCostKgs: row.unitCostKgs.toFixed(4),
            totalValueKgs: '0',
          },
        });
      }

      const inventoryUpdate = computeHistoricalInventoryAfterSale({
        currentQuantity: inventory.quantity,
        currentTotalValueKgs: inventory.totalValueKgs,
        soldQuantity: row.quantity,
      });

      await tx.inventory.update({
        where: { productId: row.productId },
        data: {
          quantity: inventoryUpdate.newQuantity.toFixed(3),
          totalValueKgs: inventoryUpdate.newTotalValueKgs.toFixed(2),
          averageUnitCostKgs: inventoryUpdate.averageUnitCostKgs.toFixed(4),
        },
      });

      await tx.inventoryMovement.create({
        data: {
          type: InventoryMovementType.SALE,
          productId: row.productId,
          quantity: row.quantity.toFixed(3),
          previousQuantity: inventoryUpdate.previousQuantity.toFixed(3),
          newQuantity: inventoryUpdate.newQuantity.toFixed(3),
          unitCost: inventoryUpdate.unitCost.toFixed(4),
          totalCost: inventoryUpdate.totalCost.toFixed(2),
          referenceType: InventoryReferenceType.SALE,
          referenceId: sale.id,
          userId: ctx.owner.id,
          transactionDate: saleDate,
        },
      });
    }

    const payment = await tx.payment.create({
      data: {
        saleId: sale.id,
        clientId: client.id,
        paymentMethodId: ctx.cashAccount.paymentMethodId,
        paymentAccountId: ctx.cashAccount.id,
        receivedByUserId: ctx.owner.id,
        amountKgs: totalAmountKgs,
        paidAt: saleDate,
      },
    });

    await tx.financialTransaction.create({
      data: {
        type: FinancialTransactionType.SALE_PAYMENT,
        paymentAccountId: ctx.cashAccount.id,
        saleId: sale.id,
        paymentId: payment.id,
        amountKgs: totalAmountKgs,
        recordedByUserId: ctx.owner.id,
        transactionAt: saleDate,
        note: `Historical import payment for ${number}`,
      },
    });

    await tx.auditLog.create({
      data: {
        userId: ctx.owner.id,
        action: 'HISTORICAL_SALE_IMPORTED',
        entityType: 'Sale',
        entityId: sale.id,
        newValue: {
          number,
          saleDate: saleDate.toISOString(),
          totalAmountKgs: totalAmountKgs.toFixed(2),
          source: 'historical-sales.tsv',
        },
      },
    });

    return {
      skipped: false,
      saleNumber: number,
      clientPhone: group.phone,
      itemCount: pricedItems.length,
      totalAmountKgs: totalAmountKgs.toFixed(2),
    };
  });
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  if (!fs.existsSync(DATA_PATH)) {
    throw new Error(`Data file not found: ${DATA_PATH}`);
  }

  const content = fs.readFileSync(DATA_PATH, 'utf8');
  const rawRows = parseTsv(content);
  const { parsed, issues } = validateAndParseRows(rawRows);
  const groups = groupSales(parsed);

  console.log(`Source rows (data lines): ${rawRows.length}`);
  console.log(`Valid line items: ${parsed.length}`);
  console.log(`Validation issues: ${issues.length}`);
  console.log(`Sale groups (date + client): ${groups.length}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'IMPORT'}`);

  if (issues.length) {
    console.log('\nValidation report:');
    for (const issue of issues) {
      console.log(`  line ${issue.lineNumber}: ${issue.message}`);
    }
  }

  const owner = await resolveOwnerUser();
  const cashAccount = await resolveCashAccount(owner.id, owner.name);
  const lookups = await buildLookups();

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const group of groups) {
    try {
      const result = await importSaleGroup(group, {
        owner,
        cashAccount,
        productByName: lookups.productByName,
        clientByPhoneDigits: lookups.clientByPhoneDigits,
        matrix: lookups.matrix,
        dryRun,
      });
      if (result.skipped) {
        skipped += 1;
        console.log(
          `Skipped ${group.key}: ${'reason' in result ? result.reason : 'unknown'}`,
        );
      } else {
        imported += 1;
        console.log(
          `Imported ${result.saleNumber} | ${result.clientPhone} | items=${result.itemCount} | total=${result.totalAmountKgs}`,
        );
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed ${group.key}: ${message}`);
    }
  }

  console.log('\nSummary:');
  console.log(`  imported: ${imported}`);
  console.log(`  skipped: ${skipped}`);
  console.log(`  failed: ${failed}`);

  if (failed > 0) {
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
