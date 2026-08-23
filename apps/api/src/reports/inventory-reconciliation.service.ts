import { Injectable } from '@nestjs/common';
import {
  InventoryMovementType,
  Prisma,
  PurchaseReceiptStatus,
  SaleStatus,
} from '@prisma/client';
import {
  businessDateRangeFilter,
  formatBusinessDate,
  resolveDateRange,
} from '../common/date.util';
import { publicDecimal } from '../common/decimal.util';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryReconciliationQueryDto } from './dto/inventory-reconciliation-query.dto';
import {
  buildChronologicalLedger,
  matchesStatusFilter,
  ProductMovementInput,
  reconcileProduct,
  ReconciliationStatus,
} from './inventory-reconciliation.logic';

const ZERO = new Prisma.Decimal(0);
const COMPLETED_SALE_STATUSES: SaleStatus[] = [
  SaleStatus.CONFIRMED,
  SaleStatus.COMPLETED,
];

type ProductRow = {
  id: string;
  name: string;
  code: string;
  categoryId: string;
  category: { id: string; name: string };
  inventory: { quantity: Prisma.Decimal } | null;
};

@Injectable()
export class InventoryReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async inventoryReconciliation(query: InventoryReconciliationQueryDto) {
    const rows = await this.buildProductReconciliationRows(query);
    const summary = summarizeReconciliation(rows);

    return {
      range: this.serializeRange(query),
      costingMethod: 'WAC',
      fifoAvailable: false,
      note: 'COGS uses weighted average cost snapshots on sale items (unitCostKgs). FIFO is not implemented.',
      summary,
      products: rows.map(serializeReconciliationRow),
    };
  }

  async negativeStockReport(query: InventoryReconciliationQueryDto) {
    const rows = await this.buildProductReconciliationRows(query);
    const negative = rows
      .filter((row) => row.calculatedStock.lt(ZERO))
      .sort((a, b) => b.calculatedStock.comparedTo(a.calculatedStock));

    return {
      range: this.serializeRange(query),
      summary: {
        negativeStockProducts: negative.length,
        totalNegativeQty: publicDecimal(
          negative.reduce(
            (sum, row) => sum.plus(row.calculatedStock.abs()),
            ZERO,
          ),
        ),
        missingPurchaseHistory: negative.filter(
          (row) => row.status === 'MISSING_PURCHASE_HISTORY',
        ).length,
      },
      products: negative.map((row) => ({
        productId: row.productId,
        productName: row.productName,
        productCode: row.productCode,
        categoryName: row.categoryName,
        purchasedQty: publicDecimal(row.purchasedQty),
        soldQty: publicDecimal(row.soldQty),
        calculatedStock: publicDecimal(row.calculatedStock),
        negativeQty: publicDecimal(row.calculatedStock.abs()),
        firstNegativeDate: row.firstNegativeDate,
        requiredPurchaseQty: publicDecimal(row.requiredPurchaseQty),
        possibleCause: row.possibleCause,
        status: row.status,
      })),
    };
  }

  async salesVsPurchasesReport(query: InventoryReconciliationQueryDto) {
    const rows = await this.buildProductReconciliationRows(query);
    const range = resolveDateRange(query);

    const byProduct = rows.map((row) => ({
      productId: row.productId,
      productName: row.productName,
      productCode: row.productCode,
      categoryName: row.categoryName,
      purchasedQty: publicDecimal(row.purchasedQty),
      soldQty: publicDecimal(row.soldQty),
      currentStock: publicDecimal(row.currentStock),
      purchaseAmountKgs: publicDecimal(row.purchaseAmountKgs),
      salesAmountKgs: publicDecimal(row.salesAmountKgs),
      grossMarginKgs:
        row.grossMarginKgs != null ? publicDecimal(row.grossMarginKgs) : null,
      cogsAvailable: row.cogsKgs != null,
    }));

    const byCategoryMap = new Map<
      string,
      {
        categoryId: string;
        categoryName: string;
        purchasedQty: Prisma.Decimal;
        soldQty: Prisma.Decimal;
        purchaseAmountKgs: Prisma.Decimal;
        salesAmountKgs: Prisma.Decimal;
        cogsKgs: Prisma.Decimal;
      }
    >();

    for (const row of rows) {
      if (!byCategoryMap.has(row.categoryId)) {
        byCategoryMap.set(row.categoryId, {
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          purchasedQty: ZERO,
          soldQty: ZERO,
          purchaseAmountKgs: ZERO,
          salesAmountKgs: ZERO,
          cogsKgs: ZERO,
        });
      }
      const bucket = byCategoryMap.get(row.categoryId)!;
      bucket.purchasedQty = bucket.purchasedQty.plus(row.purchasedQty);
      bucket.soldQty = bucket.soldQty.plus(row.soldQty);
      bucket.purchaseAmountKgs = bucket.purchaseAmountKgs.plus(row.purchaseAmountKgs);
      bucket.salesAmountKgs = bucket.salesAmountKgs.plus(row.salesAmountKgs);
      if (row.cogsKgs != null) {
        bucket.cogsKgs = bucket.cogsKgs.plus(row.cogsKgs);
      }
    }

    const months = range
      ? await this.aggregateSalesVsPurchasesByMonth(range.from, range.to)
      : await this.aggregateSalesVsPurchasesByMonthAllTime();

    const totals = rows.reduce(
      (acc, row) => ({
        purchasedQty: acc.purchasedQty.plus(row.purchasedQty),
        soldQty: acc.soldQty.plus(row.soldQty),
        purchaseAmountKgs: acc.purchaseAmountKgs.plus(row.purchaseAmountKgs),
        salesAmountKgs: acc.salesAmountKgs.plus(row.salesAmountKgs),
        cogsKgs:
          row.cogsKgs != null ? acc.cogsKgs.plus(row.cogsKgs) : acc.cogsKgs,
      }),
      {
        purchasedQty: ZERO,
        soldQty: ZERO,
        purchaseAmountKgs: ZERO,
        salesAmountKgs: ZERO,
        cogsKgs: ZERO,
      },
    );

    return {
      range: this.serializeRange(query),
      costingMethod: 'WAC',
      totals: {
        purchasedQty: publicDecimal(totals.purchasedQty),
        soldQty: publicDecimal(totals.soldQty),
        purchaseAmountKgs: publicDecimal(totals.purchaseAmountKgs),
        salesAmountKgs: publicDecimal(totals.salesAmountKgs),
        grossMarginKgs: publicDecimal(totals.salesAmountKgs.minus(totals.cogsKgs)),
        cogsAvailable: true,
      },
      byProduct,
      byCategory: Array.from(byCategoryMap.values())
        .sort((a, b) => a.categoryName.localeCompare(b.categoryName, 'ru'))
        .map((row) => ({
          categoryId: row.categoryId,
          categoryName: row.categoryName,
          purchasedQty: publicDecimal(row.purchasedQty),
          soldQty: publicDecimal(row.soldQty),
          purchaseAmountKgs: publicDecimal(row.purchaseAmountKgs),
          salesAmountKgs: publicDecimal(row.salesAmountKgs),
          grossMarginKgs: publicDecimal(row.salesAmountKgs.minus(row.cogsKgs)),
        })),
      byMonth: months,
    };
  }

  async stockMovementLedger(
    query: InventoryReconciliationQueryDto & { productId?: string },
  ) {
    const range = resolveDateRange(query);
    const where: Prisma.InventoryMovementWhereInput = {};
    if (query.productId) where.productId = query.productId;
    if (range) {
      where.transactionDate = businessDateRangeFilter(range.from, range.to);
    }

    const rows = await this.prisma.inventoryMovement.findMany({
      where,
      include: {
        product: { include: { category: true } },
      },
      orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
    });

    return {
      range: this.serializeRange(query),
      rows: rows.map((row) => ({
        date: formatBusinessDate(row.transactionDate),
        productId: row.productId,
        productName: row.product.name,
        productCode: row.product.code,
        categoryName: row.product.category.name,
        warehouse: null,
        movementType: row.type,
        reference: row.referenceId,
        quantityIn:
          row.type === InventoryMovementType.PURCHASE_RECEIPT
            ? publicDecimal(row.quantity)
            : publicDecimal(ZERO),
        quantityOut:
          row.type === InventoryMovementType.SALE
            ? publicDecimal(row.quantity)
            : publicDecimal(ZERO),
        unitCost: publicDecimal(row.unitCost),
        totalCost: publicDecimal(row.totalCost),
        runningBalance: publicDecimal(row.newQuantity),
      })),
    };
  }

  async productMovementHistory(productId: string) {
    const product = await this.prisma.product.findUniqueOrThrow({
      where: { id: productId },
      include: { category: true, inventory: true },
    });

    const movements = await this.loadMovementsForProducts([productId]);
    const productMovements = movements.get(productId) ?? [];

    const purchaseAgg = await this.loadPurchaseAggregates(
      undefined,
      undefined,
      [productId],
    );
    const saleAgg = await this.loadSaleAggregates(undefined, undefined, [
      productId,
    ]);
    const cogsAgg = await this.loadCogsAggregates(undefined, undefined, [
      productId,
    ]);

    const purchasedQty = purchaseAgg.get(productId)?.qty ?? ZERO;
    const soldQty = saleAgg.get(productId)?.qty ?? ZERO;
    const purchaseAmountKgs = purchaseAgg.get(productId)?.amount ?? ZERO;
    const salesAmountKgs = saleAgg.get(productId)?.amount ?? ZERO;
    const cogsKgs = cogsAgg.get(productId) ?? null;

    const reconciled = reconcileProduct({
      productId: product.id,
      productName: product.name,
      productCode: product.code,
      categoryId: product.categoryId,
      categoryName: product.category.name,
      openingStock: ZERO,
      purchasedQty,
      soldQty,
      adjustmentIn: ZERO,
      adjustmentOut: ZERO,
      purchaseAmountKgs,
      salesAmountKgs,
      cogsKgs,
      currentStock: product.inventory?.quantity ?? ZERO,
      movements: productMovements,
    });

    return {
      product: {
        id: product.id,
        name: product.name,
        code: product.code,
        categoryName: product.category.name,
      },
      reconciliation: serializeReconciliationRow(reconciled),
      ledger: buildChronologicalLedger(ZERO, productMovements).map((row) => ({
        ...row,
        warehouse: null,
      })),
    };
  }

  private async buildProductReconciliationRows(
    query: InventoryReconciliationQueryDto,
  ) {
    const range = resolveDateRange(query);
    const products = await this.loadProducts(query);

    const productIds = products.map((p) => p.id);
    if (productIds.length === 0) return [];

    const [purchaseAgg, saleAgg, cogsAgg, movementsByProduct] =
      await Promise.all([
        this.loadPurchaseAggregates(range?.from, range?.to, productIds),
        this.loadSaleAggregates(range?.from, range?.to, productIds),
        this.loadCogsAggregates(range?.from, range?.to, productIds),
        this.loadMovementsForProducts(productIds),
      ]);

    const reconciled = products.map((product) => {
      const purchased = purchaseAgg.get(product.id);
      const sold = saleAgg.get(product.id);
      return reconcileProduct({
        productId: product.id,
        productName: product.name,
        productCode: product.code,
        categoryId: product.categoryId,
        categoryName: product.category.name,
        openingStock: ZERO,
        purchasedQty: purchased?.qty ?? ZERO,
        soldQty: sold?.qty ?? ZERO,
        adjustmentIn: ZERO,
        adjustmentOut: ZERO,
        purchaseAmountKgs: purchased?.amount ?? ZERO,
        salesAmountKgs: sold?.amount ?? ZERO,
        cogsKgs: cogsAgg.get(product.id) ?? null,
        currentStock: product.inventory?.quantity ?? ZERO,
        movements: movementsByProduct.get(product.id) ?? [],
      });
    });

    return reconciled.filter((row) => {
      if (query.status && !matchesStatusFilter(row.status, query.status)) {
        return false;
      }
      if (query.productId && row.productId !== query.productId) {
        return false;
      }
      if (query.categoryId && row.categoryId !== query.categoryId) {
        return false;
      }
      if (query.search?.trim()) {
        const q = query.search.trim().toLowerCase();
        return (
          row.productName.toLowerCase().includes(q) ||
          row.productCode.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }

  private async loadProducts(query: InventoryReconciliationQueryDto) {
    const where: Prisma.ProductWhereInput = { isActive: true };
    if (query.productId) where.id = query.productId;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.search?.trim()) {
      const q = query.search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
      ];
    }

    return this.prisma.product.findMany({
      where,
      include: {
        category: true,
        inventory: true,
      },
      orderBy: { name: 'asc' },
    }) as Promise<ProductRow[]>;
  }

  private purchaseDateFilter(from?: Date, to?: Date) {
    if (!from || !to) return undefined;
    return businessDateRangeFilter(from, to);
  }

  private saleDateFilter(from?: Date, to?: Date) {
    if (!from || !to) return undefined;
    return businessDateRangeFilter(from, to);
  }

  private async loadPurchaseAggregates(
    from?: Date,
    to?: Date,
    productIds?: string[],
  ) {
    const receiptDateFilter = this.purchaseDateFilter(from, to);
    const rows = await this.prisma.purchaseReceiptItem.groupBy({
      by: ['productId'],
      where: {
        ...(productIds ? { productId: { in: productIds } } : {}),
        receipt: {
          status: PurchaseReceiptStatus.COMPLETED,
          ...(receiptDateFilter
            ? { warehouseReceiptDate: receiptDateFilter }
            : {}),
        },
      },
      _sum: {
        receivedQuantity: true,
        totalLandedCostKgs: true,
      },
    });

    const map = new Map<string, { qty: Prisma.Decimal; amount: Prisma.Decimal }>();
    for (const row of rows) {
      map.set(row.productId, {
        qty: row._sum.receivedQuantity ?? ZERO,
        amount: row._sum.totalLandedCostKgs ?? ZERO,
      });
    }
    return map;
  }

  private async loadSaleAggregates(
    from?: Date,
    to?: Date,
    productIds?: string[],
  ) {
    const saleDateFilter = this.saleDateFilter(from, to);
    const rows = await this.prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        ...(productIds ? { productId: { in: productIds } } : {}),
        sale: {
          status: { in: COMPLETED_SALE_STATUSES },
          ...(saleDateFilter ? { saleDate: saleDateFilter } : {}),
        },
      },
      _sum: {
        quantity: true,
        lineTotalKgs: true,
      },
    });

    const map = new Map<string, { qty: Prisma.Decimal; amount: Prisma.Decimal }>();
    for (const row of rows) {
      map.set(row.productId, {
        qty: row._sum.quantity ?? ZERO,
        amount: row._sum.lineTotalKgs ?? ZERO,
      });
    }
    return map;
  }

  private async loadCogsAggregates(
    from?: Date,
    to?: Date,
    productIds?: string[],
  ) {
    const dateClause =
      from && to
        ? Prisma.sql`AND s."saleDate" >= ${from} AND s."saleDate" <= ${to}`
        : Prisma.empty;
    const productClause = productIds?.length
      ? Prisma.sql`AND si."productId" IN (${Prisma.join(productIds)})`
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<
      Array<{ productId: string; cogsKgs: Prisma.Decimal }>
    >(Prisma.sql`
      SELECT si."productId" AS "productId",
             COALESCE(SUM(si.quantity * si."unitCostKgs"), 0) AS "cogsKgs"
      FROM "SaleItem" si
      INNER JOIN "Sale" s ON s.id = si."saleId"
      WHERE s.status IN ('CONFIRMED', 'COMPLETED')
      ${dateClause}
      ${productClause}
      GROUP BY si."productId"
    `);

    const map = new Map<string, Prisma.Decimal>();
    for (const row of rows) {
      map.set(row.productId, new Prisma.Decimal(row.cogsKgs));
    }
    return map;
  }

  private async loadMovementsForProducts(productIds: string[]) {
    const rows = await this.prisma.inventoryMovement.findMany({
      where: { productId: { in: productIds } },
      select: {
        productId: true,
        type: true,
        quantity: true,
        transactionDate: true,
        createdAt: true,
        referenceId: true,
      },
      orderBy: [{ transactionDate: 'asc' }, { createdAt: 'asc' }],
    });

    const map = new Map<string, ProductMovementInput[]>();
    for (const row of rows) {
      const date = row.transactionDate ?? row.createdAt;
      const movement: ProductMovementInput = {
        date,
        kind: row.type as ProductMovementInput['kind'],
        quantityIn:
          row.type === InventoryMovementType.PURCHASE_RECEIPT
            ? row.quantity
            : ZERO,
        quantityOut:
          row.type === InventoryMovementType.SALE ? row.quantity : ZERO,
        reference: row.referenceId,
      };
      const list = map.get(row.productId) ?? [];
      list.push(movement);
      map.set(row.productId, list);
    }
    return map;
  }

  private async aggregateSalesVsPurchasesByMonth(from: Date, to: Date) {
    const receiptRows = await this.prisma.purchaseReceipt.findMany({
      where: {
        status: PurchaseReceiptStatus.COMPLETED,
        warehouseReceiptDate: businessDateRangeFilter(from, to),
      },
      select: {
        warehouseReceiptDate: true,
        totalReceivedQuantity: true,
        totalLandedCostKgs: true,
      },
    });

    const saleRows = await this.prisma.sale.findMany({
      where: {
        status: { in: COMPLETED_SALE_STATUSES },
        saleDate: businessDateRangeFilter(from, to),
      },
      select: {
        saleDate: true,
        totalAmountKgs: true,
        items: { select: { quantity: true } },
      },
    });

    return mergeMonthBuckets(receiptRows, saleRows);
  }

  private async aggregateSalesVsPurchasesByMonthAllTime() {
    const receiptRows = await this.prisma.purchaseReceipt.findMany({
      where: { status: PurchaseReceiptStatus.COMPLETED },
      select: {
        warehouseReceiptDate: true,
        totalReceivedQuantity: true,
        totalLandedCostKgs: true,
      },
    });

    const saleRows = await this.prisma.sale.findMany({
      where: { status: { in: COMPLETED_SALE_STATUSES } },
      select: {
        saleDate: true,
        totalAmountKgs: true,
        items: { select: { quantity: true } },
      },
    });

    return mergeMonthBuckets(receiptRows, saleRows);
  }

  private serializeRange(query: InventoryReconciliationQueryDto) {
    const range = resolveDateRange(query);
    if (!range) {
      return { preset: null, from: null, to: null, allTime: true };
    }
    return {
      preset: range.preset,
      from: range.fromIso,
      to: range.toIso,
      allTime: false,
    };
  }
}

function summarizeReconciliation(
  rows: ReturnType<typeof reconcileProduct>[],
) {
  let totalPurchased = ZERO;
  let totalSold = ZERO;
  let totalCurrentStock = ZERO;
  let totalPurchaseAmount = ZERO;
  let totalSalesAmount = ZERO;
  let negativeStockProducts = 0;
  let stockMismatches = 0;
  let missingPurchaseHistory = 0;

  for (const row of rows) {
    totalPurchased = totalPurchased.plus(row.purchasedQty);
    totalSold = totalSold.plus(row.soldQty);
    totalCurrentStock = totalCurrentStock.plus(row.currentStock);
    totalPurchaseAmount = totalPurchaseAmount.plus(row.purchaseAmountKgs);
    totalSalesAmount = totalSalesAmount.plus(row.salesAmountKgs);
    if (row.calculatedStock.lt(ZERO)) negativeStockProducts += 1;
    if (row.status === 'STOCK_MISMATCH') stockMismatches += 1;
    if (row.status === 'MISSING_PURCHASE_HISTORY') missingPurchaseHistory += 1;
  }

  return {
    totalProducts: rows.length,
    totalPurchasedQty: publicDecimal(totalPurchased),
    totalSoldQty: publicDecimal(totalSold),
    totalCurrentStock: publicDecimal(totalCurrentStock),
    negativeStockProducts,
    stockMismatches,
    missingPurchaseHistory,
    totalPurchaseAmountKgs: publicDecimal(totalPurchaseAmount),
    totalSalesAmountKgs: publicDecimal(totalSalesAmount),
  };
}

function serializeReconciliationRow(row: ReturnType<typeof reconcileProduct>) {
  return {
    productId: row.productId,
    productName: row.productName,
    productCode: row.productCode,
    categoryId: row.categoryId,
    categoryName: row.categoryName,
    openingStock: publicDecimal(row.openingStock),
    purchasedQty: publicDecimal(row.purchasedQty),
    soldQty: publicDecimal(row.soldQty),
    adjustmentIn: publicDecimal(row.adjustmentIn),
    adjustmentOut: publicDecimal(row.adjustmentOut),
    calculatedStock: publicDecimal(row.calculatedStock),
    currentStock: publicDecimal(row.currentStock),
    difference: publicDecimal(row.difference),
    purchaseAmountKgs: publicDecimal(row.purchaseAmountKgs),
    salesAmountKgs: publicDecimal(row.salesAmountKgs),
    cogsKgs: row.cogsKgs != null ? publicDecimal(row.cogsKgs) : null,
    grossMarginKgs:
      row.grossMarginKgs != null ? publicDecimal(row.grossMarginKgs) : null,
    status: row.status as ReconciliationStatus,
    firstNegativeDate: row.firstNegativeDate,
    negativeQty: publicDecimal(row.negativeQty),
    requiredPurchaseQty: publicDecimal(row.requiredPurchaseQty),
    possibleCause: row.possibleCause,
  };
}

function mergeMonthBuckets(
  receiptRows: Array<{
    warehouseReceiptDate: Date;
    totalReceivedQuantity: Prisma.Decimal;
    totalLandedCostKgs: Prisma.Decimal;
  }>,
  saleRows: Array<{
    saleDate: Date;
    totalAmountKgs: Prisma.Decimal;
    items: Array<{ quantity: Prisma.Decimal }>;
  }>,
) {
  const monthMap = new Map<
    string,
    {
      monthKey: string;
      purchasedQty: Prisma.Decimal;
      soldQty: Prisma.Decimal;
      purchaseAmountKgs: Prisma.Decimal;
      salesAmountKgs: Prisma.Decimal;
    }
  >();

  for (const row of receiptRows) {
    const monthKey = monthKeyFromDate(row.warehouseReceiptDate);
    const bucket = getMonthBucket(monthMap, monthKey);
    bucket.purchasedQty = bucket.purchasedQty.plus(row.totalReceivedQuantity);
    bucket.purchaseAmountKgs = bucket.purchaseAmountKgs.plus(
      row.totalLandedCostKgs,
    );
  }

  for (const row of saleRows) {
    const monthKey = monthKeyFromDate(row.saleDate);
    const bucket = getMonthBucket(monthMap, monthKey);
    bucket.salesAmountKgs = bucket.salesAmountKgs.plus(row.totalAmountKgs);
    for (const item of row.items) {
      bucket.soldQty = bucket.soldQty.plus(item.quantity);
    }
  }

  return Array.from(monthMap.values())
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    .map((row) => ({
      monthKey: row.monthKey,
      purchasedQty: publicDecimal(row.purchasedQty),
      soldQty: publicDecimal(row.soldQty),
      purchaseAmountKgs: publicDecimal(row.purchaseAmountKgs),
      salesAmountKgs: publicDecimal(row.salesAmountKgs),
    }));
}

function getMonthBucket(
  monthMap: Map<
    string,
    {
      monthKey: string;
      purchasedQty: Prisma.Decimal;
      soldQty: Prisma.Decimal;
      purchaseAmountKgs: Prisma.Decimal;
      salesAmountKgs: Prisma.Decimal;
    }
  >,
  monthKey: string,
) {
  if (!monthMap.has(monthKey)) {
    monthMap.set(monthKey, {
      monthKey,
      purchasedQty: ZERO,
      soldQty: ZERO,
      purchaseAmountKgs: ZERO,
      salesAmountKgs: ZERO,
    });
  }
  return monthMap.get(monthKey)!;
}

function monthKeyFromDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}
