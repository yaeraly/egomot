/**
 * Historical sales importer — supports monthly incremental batch imports.
 *
 * Usage:
 *   npm run import:historical-sales -- --validate data/historical-sales.tsv
 *   npm run import:historical-sales -- data/historical-sales.tsv
 *   npm run import:historical-sales -- --final-validate data/historical-sales.tsv
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
import {
  BatchStatus,
  buildSaleGroupKey,
  activeImportedSourceRowIds,
  filterNewRows,
  groupHistoricalSales,
  normalizePhoneDigits,
  ParsedSalesRow,
  printBatchValidationReport,
  printFinalReconciliationReport,
  resolveImportStatus,
  resolveProductName,
  resolveValidateExitCode,
  SalesGroup,
  validateFinalHistoricalSales,
  validateHistoricalSalesBatch,
  WALK_IN_CUSTOMER_NAME,
  WALK_IN_CUSTOMER_PHONE,
  WALK_IN_GROUP_TOKEN,
} from '../src/sales/historical-sales-import.logic';

const prisma = new PrismaClient();
const HISTORICAL_SALE_ITEM_ACTION = 'HISTORICAL_SALE_ITEM_IMPORTED';

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

  return { productByName, clientByPhoneDigits, matrix };
}

async function loadImportedSourceRowIds(): Promise<Set<string>> {
  // Audit logs survive Sale deletion. Only treat a source row as imported
  // when the Sale it created still exists, so the same TSV can be re-imported.
  const rows = await prisma.auditLog.findMany({
    where: { action: HISTORICAL_SALE_ITEM_ACTION },
    select: { entityId: true, newValue: true },
  });

  const markers = rows.map((row) => {
    const payload = row.newValue as { saleId?: string } | null;
    return {
      sourceRowId: row.entityId,
      saleId: payload?.saleId ?? null,
    };
  });

  const saleIds = markers
    .map((row) => row.saleId)
    .filter((id): id is string => Boolean(id));

  const existing = saleIds.length
    ? await prisma.sale.findMany({
        where: { id: { in: saleIds } },
        select: { id: true },
      })
    : [];

  return activeImportedSourceRowIds(
    markers,
    new Set(existing.map((row) => row.id)),
  );
}

async function ensureWalkInCustomer(): Promise<{
  id: string;
  phone: string;
  name: string;
  clientType: ClientType;
}> {
  const matches = await prisma.client.findMany({
    where: {
      OR: [
        { name: { equals: WALK_IN_CUSTOMER_NAME, mode: 'insensitive' } },
        { name: { equals: 'Walk-in', mode: 'insensitive' } },
        { name: { equals: 'Розничный', mode: 'insensitive' } },
        { phone: WALK_IN_CUSTOMER_PHONE },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });

  const unique = new Map(matches.map((row) => [row.id, row]));
  if (unique.size > 1) {
    const names = [...unique.values()]
      .map((row) => `${row.name} (${row.id})`)
      .join(', ');
    throw new Error(
      `Multiple Walk-in Customer records found: ${names}. Resolve the ambiguity before importing.`,
    );
  }

  const existing = unique.size === 1 ? [...unique.values()][0] : null;
  if (existing) return existing;

  return prisma.client.create({
    data: {
      name: WALK_IN_CUSTOMER_NAME,
      phone: WALK_IN_CUSTOMER_PHONE,
      clientType: ClientType.RETAIL,
      isActive: true,
    },
  });
}

function resolveProductNameLocal(name: string): string {
  return resolveProductName(name);
}

function lookupProduct(
  productName: string,
  productByName: Map<
    string,
    { id: string; name: string; baseMarkupPercent: Prisma.Decimal | null }
  >,
) {
  const canonicalName = resolveProductNameLocal(productName);
  return productByName.get(canonicalName) ?? null;
}

function filterRowsWithProducts(
  rows: ParsedSalesRow[],
  productByName: Map<
    string,
    { id: string; name: string; baseMarkupPercent: Prisma.Decimal | null }
  >,
): {
  importableRows: ParsedSalesRow[];
  productIssues: Array<{ lineNumber: number; message: string }>;
} {
  const importableRows: ParsedSalesRow[] = [];
  const productIssues: Array<{ lineNumber: number; message: string }> = [];

  for (const row of rows) {
    const product = lookupProduct(row.productName, productByName);
    if (!product) {
      productIssues.push({
        lineNumber: row.lineNumber,
        message: `product not found: ${row.productName}`,
      });
      continue;
    }
    importableRows.push(row);
  }

  return { importableRows, productIssues };
}

function resolveClient(
  group: { phoneDigits: string; isWalkIn: boolean },
  clientByPhoneDigits: Map<
    string,
    { id: string; phone: string; name: string; clientType: ClientType }
  >,
  walkInCustomer: { id: string; phone: string; name: string; clientType: ClientType },
) {
  if (group.isWalkIn || group.phoneDigits === WALK_IN_GROUP_TOKEN) {
    return walkInCustomer;
  }
  return clientByPhoneDigits.get(group.phoneDigits) ?? walkInCustomer;
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
  const inventory = await prisma.inventory.findUnique({ where: { productId } });
  if (inventory && inventory.averageUnitCostKgs.gt(0)) {
    return inventory.averageUnitCostKgs;
  }
  return dec(0);
}

async function importSaleGroup(
  group: SalesGroup,
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
    walkInCustomer: {
      id: string;
      phone: string;
      name: string;
      clientType: ClientType;
    };
    sourceFileLabel: string;
  },
) {
  const idempotencyKey = `historical-${group.key}`;

  const existingSale = await prisma.sale.findUnique({
    where: { idempotencyKey },
  });
  if (existingSale) {
    return {
      skipped: true,
      reason: 'sale group already imported',
      saleNumber: existingSale.number,
      itemCount: 0,
      totalAmountKgs: '0.00',
      usedWalkIn: false,
    };
  }

  const client = resolveClient(
    group,
    ctx.clientByPhoneDigits,
    ctx.walkInCustomer,
  );
  const usedWalkIn = client.id === ctx.walkInCustomer.id;

  const clientCategory = defaultClientCategory();
  const clientMarkupPercent = resolveClientMarkup(
    client.clientType,
    clientCategory,
    ctx.matrix,
  );

  const pricedItems: Array<{
    sourceRow: ParsedSalesRow;
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
    const product = lookupProduct(item.productName, ctx.productByName);
    if (!product) continue;

    const unitCostKgs = await resolveUnitCost(product.id);
    const unitPriceKgs = item.unitPriceKgs;
    const finalMarkupPercent = unitCostKgs.gt(0)
      ? roundMarkup(unitPriceKgs.div(unitCostKgs).minus(1).times(100))
      : roundMarkup(dec(product.baseMarkupPercent ?? 0).plus(clientMarkupPercent));
    const lineTotalKgs = roundMoney(unitPriceKgs.times(item.quantity));

    pricedItems.push({
      sourceRow: item,
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

  if (pricedItems.length === 0) {
    return {
      skipped: true,
      reason: 'no importable items in group',
      saleNumber: '',
      itemCount: 0,
      totalAmountKgs: '0.00',
      usedWalkIn,
    };
  }

  const totalAmountKgs = roundMoney(
    pricedItems.reduce((sum, row) => sum.plus(row.lineTotalKgs), dec(0)),
  );

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

      await tx.auditLog.create({
        data: {
          userId: ctx.owner.id,
          action: HISTORICAL_SALE_ITEM_ACTION,
          entityType: 'SaleItem',
          entityId: row.sourceRow.sourceRowId,
          newValue: {
            sourceRowId: row.sourceRow.sourceRowId,
            saleId: sale.id,
            sourceFile: ctx.sourceFileLabel,
            lineNumber: row.sourceRow.lineNumber,
          },
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
          idempotencyKey,
          saleDate: saleDate.toISOString(),
          totalAmountKgs: totalAmountKgs.toFixed(2),
          sourceFile: ctx.sourceFileLabel,
          itemCount: pricedItems.length,
        },
      },
    });

    return {
      skipped: false,
      saleNumber: number,
      clientPhone: group.phone,
      itemCount: pricedItems.length,
      totalAmountKgs: totalAmountKgs.toFixed(2),
      usedWalkIn,
    };
  });
}

function resolveDataPath(): string {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  const candidates = [
    args[0],
    path.join('data', 'historical-sales.tsv'),
    path.join('prisma', 'data', 'historical-sales.tsv'),
    path.join('apps', 'api', 'data', 'historical-sales.tsv'),
    path.join('apps', 'api', 'prisma', 'data', 'historical-sales.tsv'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const resolved = path.isAbsolute(candidate)
      ? candidate
      : path.resolve(process.cwd(), candidate);
    if (fs.existsSync(resolved)) return resolved;
  }

  return path.resolve(process.cwd(), args[0] ?? path.join('data', 'historical-sales.tsv'));
}

function resolveExitCode(status: BatchStatus): number {
  return resolveValidateExitCode(status);
}

function printBatchImportReport(input: {
  sourceFile: string;
  sourceRows: number;
  validRows: number;
  invalidRows: number;
  alreadyImported: number;
  newRowsImported: number;
  duplicatesSkipped: number;
  saleItems: number;
  salesCreated: number;
  quantity: string;
  salesAmount: string;
  walkInRows: number;
  walkInSales: number;
  existingCustomerSales: number;
  cashPayments: number;
  cashAmount: string;
  productIssues: Array<{ lineNumber: number; message: string }>;
  parseIssues: Array<{ lineNumber: number; message: string }>;
  status: BatchStatus;
}) {
  console.log('\n=== HISTORICAL SALES BATCH IMPORT ===');
  console.log(`Source file:       ${input.sourceFile}`);
  console.log('');
  console.log(`Source rows:       ${input.sourceRows}`);
  console.log(`Valid rows:        ${input.validRows}`);
  console.log(`Invalid rows:      ${input.invalidRows}`);
  console.log('');
  console.log(`Already imported:  ${input.alreadyImported}`);
  console.log(`New rows imported: ${input.newRowsImported}`);
  console.log(`Duplicates skipped: ${input.duplicatesSkipped}`);
  console.log('');
  console.log(`Sale Items:        ${input.saleItems}`);
  console.log(`Sales created:     ${input.salesCreated}`);
  console.log('');
  console.log(`Quantity:          ${input.quantity}`);
  console.log(`Sales amount:      ${input.salesAmount} сом`);
  console.log('');
  console.log(`Walk-in rows:      ${input.walkInRows}`);
  console.log(`Walk-in sales:     ${input.walkInSales}`);
  console.log(`Existing customers: ${input.existingCustomerSales}`);
  console.log('');
  console.log(`Cash payments:     ${input.cashPayments}`);
  console.log(`Cash amount:       ${input.cashAmount} сом`);

  const allIssues = [...input.parseIssues, ...input.productIssues];
  if (allIssues.length) {
    console.log('\nSkipped invalid rows:');
    for (const issue of allIssues) {
      console.log(`Row ${issue.lineNumber} — ${issue.message}`);
    }
  }

  console.log(`\nStatus: ${input.status}`);
}

async function main() {
  const validateOnly = process.argv.includes('--validate');
  const finalValidate = process.argv.includes('--final-validate');
  const dataPath = resolveDataPath();
  const sourceFileLabel = path.relative(process.cwd(), dataPath);

  if (!fs.existsSync(dataPath)) {
    throw new Error(`Data file not found: ${dataPath}`);
  }

  const content = fs.readFileSync(dataPath, 'utf8');

  if (finalValidate) {
    const finalResult = validateFinalHistoricalSales(content, dataPath);
    printFinalReconciliationReport(finalResult);
    process.exitCode = finalResult.status === 'PASS' ? 0 : 1;
    return;
  }

  const batch = validateHistoricalSalesBatch(content, dataPath);
  printBatchValidationReport(batch, sourceFileLabel);

  if (validateOnly) {
    process.exitCode = resolveExitCode(batch.status);
    return;
  }

  if (batch.status === 'ERROR') {
    console.error('\nImport error: no valid rows in current batch.');
    process.exit(1);
  }

  const owner = await resolveOwnerUser();
  const cashAccount = await resolveCashAccount(owner.id, owner.name);
  const walkInCustomer = await ensureWalkInCustomer();
  const lookups = await buildLookups();
  const importedSourceRowIds = await loadImportedSourceRowIds();

  const { newRows, duplicatesSkipped } = filterNewRows(
    batch.parsed,
    importedSourceRowIds,
  );
  const { importableRows, productIssues } = filterRowsWithProducts(
    newRows,
    lookups.productByName,
  );
  const groups = groupHistoricalSales(importableRows);

  let salesCreated = 0;
  let saleItemsImported = 0;
  let newRowsImported = 0;
  let walkInSales = 0;
  let existingCustomerSales = 0;
  let cashPayments = 0;
  let cashAmount = dec(0);
  let importQuantity = dec(0);
  let importAmount = dec(0);
  let groupsSkipped = 0;
  let failed = 0;

  for (const group of groups) {
    try {
      const result = await importSaleGroup(group, {
        owner,
        cashAccount,
        productByName: lookups.productByName,
        clientByPhoneDigits: lookups.clientByPhoneDigits,
        matrix: lookups.matrix,
        walkInCustomer,
        sourceFileLabel,
      });

      if (result.skipped) {
        groupsSkipped += 1;
        continue;
      }

      salesCreated += 1;
      saleItemsImported += result.itemCount;
      newRowsImported += result.itemCount;
      importQuantity = importQuantity.plus(
        group.items.reduce((sum, row) => sum.plus(row.quantity), dec(0)),
      );
      importAmount = importAmount.plus(dec(result.totalAmountKgs));
      cashPayments += 1;
      cashAmount = cashAmount.plus(dec(result.totalAmountKgs));
      if (result.usedWalkIn) walkInSales += 1;
      else existingCustomerSales += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Failed ${buildSaleGroupKey(group)}: ${message}`);
    }
  }

  const importStatus = resolveImportStatus({
    failed,
    newRowsImported,
    alreadyImported: duplicatesSkipped,
    invalidRows: batch.totals.invalidRows + productIssues.length,
  });
  const status: BatchStatus =
    failed === 0 && groupsSkipped > 0 && newRowsImported === 0
      ? 'PASS'
      : importStatus;

  printBatchImportReport({
    sourceFile: sourceFileLabel,
    sourceRows: batch.totals.sourceRows,
    validRows: batch.totals.validRows,
    invalidRows: batch.totals.invalidRows + productIssues.length,
    alreadyImported: duplicatesSkipped,
    newRowsImported,
    duplicatesSkipped,
    saleItems: saleItemsImported,
    salesCreated,
    quantity: importQuantity.toFixed(),
    salesAmount: importAmount.toFixed(2),
    walkInRows: batch.totals.walkInRows,
    walkInSales,
    existingCustomerSales,
    cashPayments,
    cashAmount: cashAmount.toFixed(2),
    productIssues,
    parseIssues: batch.issues,
    status,
  });

  process.exitCode = resolveExitCode(status);
}

main()
  .catch((error) => {
    console.error('BLOCKED:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
