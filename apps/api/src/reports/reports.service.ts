import { Injectable } from '@nestjs/common';
import {
  InventoryMovementType,
  Prisma,
  PurchaseStatus,
  SaleStatus,
} from '@prisma/client';
import {
  businessDateRangeFilter,
  formatBusinessDate,
  resolveDateRange,
} from '../common/date.util';
import { publicDecimal } from '../common/decimal.util';
import { PrismaService } from '../prisma/prisma.service';
import { ReportDateQueryDto } from './dto/report-date-query.dto';

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private resolveRange(query: ReportDateQueryDto) {
    const range = resolveDateRange(query);
    if (!range) {
      throw new Error('REPORT_RANGE_REQUIRED');
    }
    return range;
  }

  async purchaseReport(query: ReportDateQueryDto) {
    const range = this.resolveRange(query);
    const purchases = await this.prisma.purchase.findMany({
      where: {
        purchaseDate: businessDateRangeFilter(range.from, range.to),
        status: { not: PurchaseStatus.DRAFT },
      },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, code: true, unit: true },
            },
          },
        },
      },
      orderBy: [{ purchaseDate: 'asc' }, { number: 'asc' }],
    });

    type ProductBucket = {
      productId: string;
      productName: string;
      productCode: string;
      unit: string;
      quantity: Prisma.Decimal;
      totalAmountKgs: Prisma.Decimal;
      purchaseCostKgs: Prisma.Decimal;
    };

    type MonthBucket = {
      monthKey: string;
      monthLabel: string;
      totalAmountKgs: Prisma.Decimal;
      totalQuantity: Prisma.Decimal;
      purchaseCount: number;
      products: Map<string, ProductBucket>;
    };

    const monthMap = new Map<string, MonthBucket>();
    const periodProducts = new Map<string, ProductBucket>();
    let periodTotalAmount = new Prisma.Decimal(0);
    let periodTotalQuantity = new Prisma.Decimal(0);

    for (const purchase of purchases) {
      if (!purchase.purchaseDate) continue;

      const monthKey = reportMonthKey(purchase.purchaseDate);
      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, {
          monthKey,
          monthLabel: reportMonthLabel(monthKey),
          totalAmountKgs: new Prisma.Decimal(0),
          totalQuantity: new Prisma.Decimal(0),
          purchaseCount: 0,
          products: new Map(),
        });
      }

      const bucket = monthMap.get(monthKey)!;
      bucket.totalAmountKgs = bucket.totalAmountKgs.plus(
        purchase.estimatedTotalLandedCostKgs,
      );
      bucket.totalQuantity = bucket.totalQuantity.plus(purchase.totalQuantity);
      bucket.purchaseCount += 1;
      periodTotalAmount = periodTotalAmount.plus(
        purchase.estimatedTotalLandedCostKgs,
      );
      periodTotalQuantity = periodTotalQuantity.plus(purchase.totalQuantity);

      for (const item of purchase.items) {
        addPurchaseProductBucket(bucket.products, item);
        addPurchaseProductBucket(periodProducts, item);
      }
    }

    return {
      range: { preset: range.preset, from: range.fromIso, to: range.toIso },
      totals: {
        totalAmountKgs: publicDecimal(periodTotalAmount),
        totalQuantity: publicDecimal(periodTotalQuantity),
        purchaseCount: purchases.filter((row) => row.purchaseDate).length,
      },
      products: serializePurchaseProductBuckets(periodProducts),
      months: Array.from(monthMap.values())
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        .map((month) => ({
          monthKey: month.monthKey,
          monthLabel: month.monthLabel,
          totalAmountKgs: publicDecimal(month.totalAmountKgs),
          totalQuantity: publicDecimal(month.totalQuantity),
          purchaseCount: month.purchaseCount,
          products: serializePurchaseProductBuckets(month.products),
        })),
    };
  }

  async receiptReport(query: ReportDateQueryDto) {
    const range = this.resolveRange(query);
    const rows = await this.prisma.purchaseReceipt.findMany({
      where: {
        warehouseReceiptDate: businessDateRangeFilter(range.from, range.to),
        status: 'COMPLETED',
      },
      include: {
        purchase: true,
        supplier: true,
        receivedBy: { select: { id: true, name: true } },
        discrepancies: true,
      },
      orderBy: [{ warehouseReceiptDate: 'desc' }, { number: 'desc' }],
    });

    return {
      range: { preset: range.preset, from: range.fromIso, to: range.toIso },
      rows: rows.map((row) => {
        const shortage = row.discrepancies
          .filter((d) => d.type === 'SHORTAGE')
          .reduce(
            (sum, d) => sum.plus(d.difference.abs()),
            new Prisma.Decimal(0),
          );
        const excess = row.discrepancies
          .filter((d) => d.type === 'EXCESS')
          .reduce((sum, d) => sum.plus(d.difference), new Prisma.Decimal(0));

        return {
          warehouseReceiptDate: formatBusinessDate(row.warehouseReceiptDate),
          purchaseNumber: row.purchase.number,
          purchaseDate: formatBusinessDate(row.purchase.purchaseDate),
          supplierName: row.supplier.name,
          totalOrderedQuantity: publicDecimal(row.totalOrderedQuantity),
          totalReceivedQuantity: publicDecimal(row.totalReceivedQuantity),
          totalShortage: publicDecimal(shortage),
          totalExcess: publicDecimal(excess),
          totalTransportKgs: publicDecimal(row.totalTransportKgs),
          totalLandedCostKgs: publicDecimal(row.totalLandedCostKgs),
          receivedByName: row.receivedBy.name,
          number: row.number,
          createdAt: row.createdAt.toISOString(),
        };
      }),
    };
  }

  async inventoryMovementReport(query: ReportDateQueryDto) {
    const range = this.resolveRange(query);
    const rows = await this.prisma.inventoryMovement.findMany({
      where: {
        transactionDate: businessDateRangeFilter(range.from, range.to),
      },
      include: {
        product: true,
        user: { select: { id: true, name: true } },
      },
      orderBy: [{ transactionDate: 'desc' }, { createdAt: 'desc' }],
    });

    return {
      range: { preset: range.preset, from: range.fromIso, to: range.toIso },
      rows: rows.map((row) => ({
        transactionDate: formatBusinessDate(row.transactionDate),
        productName: row.product.name,
        productCode: row.product.code,
        type: row.type,
        typeLabel: movementTypeLabel(row.type),
        quantity: publicDecimal(row.quantity),
        unitCost: publicDecimal(row.unitCost),
        totalCost: publicDecimal(row.totalCost),
        balanceAfter: publicDecimal(row.newQuantity),
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        employeeName: row.user.name,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async saleReport(query: ReportDateQueryDto) {
    const range = this.resolveRange(query);
    const sales = await this.prisma.sale.findMany({
      where: {
        saleDate: businessDateRangeFilter(range.from, range.to),
        status: { in: [SaleStatus.CONFIRMED, SaleStatus.COMPLETED] },
      },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, code: true, unit: true },
            },
          },
        },
      },
      orderBy: { saleDate: 'asc' },
    });

    type ProductBucket = {
      productId: string;
      productName: string;
      productCode: string;
      unit: string;
      quantity: Prisma.Decimal;
      totalAmountKgs: Prisma.Decimal;
    };

    type MonthBucket = {
      monthKey: string;
      monthLabel: string;
      totalAmountKgs: Prisma.Decimal;
      totalQuantity: Prisma.Decimal;
      saleCount: number;
      products: Map<string, ProductBucket>;
    };

    const monthMap = new Map<string, MonthBucket>();
    let periodTotalAmount = new Prisma.Decimal(0);
    let periodTotalQuantity = new Prisma.Decimal(0);

    for (const sale of sales) {
      const monthKey = reportMonthKey(sale.saleDate);
      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, {
          monthKey,
          monthLabel: reportMonthLabel(monthKey),
          totalAmountKgs: new Prisma.Decimal(0),
          totalQuantity: new Prisma.Decimal(0),
          saleCount: 0,
          products: new Map(),
        });
      }

      const bucket = monthMap.get(monthKey)!;
      bucket.totalAmountKgs = bucket.totalAmountKgs.plus(sale.totalAmountKgs);
      bucket.saleCount += 1;
      periodTotalAmount = periodTotalAmount.plus(sale.totalAmountKgs);

      for (const item of sale.items) {
        bucket.totalQuantity = bucket.totalQuantity.plus(item.quantity);
        periodTotalQuantity = periodTotalQuantity.plus(item.quantity);

        if (!bucket.products.has(item.productId)) {
          bucket.products.set(item.productId, {
            productId: item.productId,
            productName: item.product.name,
            productCode: item.product.code,
            unit: item.product.unit,
            quantity: new Prisma.Decimal(0),
            totalAmountKgs: new Prisma.Decimal(0),
          });
        }

        const productBucket = bucket.products.get(item.productId)!;
        productBucket.quantity = productBucket.quantity.plus(item.quantity);
        productBucket.totalAmountKgs = productBucket.totalAmountKgs.plus(
          item.lineTotalKgs,
        );
      }
    }

    const months = Array.from(monthMap.values())
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .map((month) => ({
        monthKey: month.monthKey,
        monthLabel: month.monthLabel,
        totalAmountKgs: publicDecimal(month.totalAmountKgs),
        totalQuantity: publicDecimal(month.totalQuantity),
        saleCount: month.saleCount,
        products: Array.from(month.products.values())
          .sort((a, b) => a.productName.localeCompare(b.productName, 'ru'))
          .map((product) => ({
            productId: product.productId,
            productName: product.productName,
            productCode: product.productCode,
            unit: product.unit,
            quantity: publicDecimal(product.quantity),
            totalAmountKgs: publicDecimal(product.totalAmountKgs),
          })),
      }));

    return {
      range: { preset: range.preset, from: range.fromIso, to: range.toIso },
      totals: {
        totalAmountKgs: publicDecimal(periodTotalAmount),
        totalQuantity: publicDecimal(periodTotalQuantity),
        saleCount: sales.length,
      },
      months,
    };
  }

  async missingBusinessDates() {
    const [purchases, movements] = await Promise.all([
      this.prisma.purchase.findMany({
        where: { purchaseDate: null },
        select: { id: true, number: true, createdAt: true, status: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.inventoryMovement.findMany({
        where: { transactionDate: null },
        select: {
          id: true,
          type: true,
          createdAt: true,
          referenceType: true,
          referenceId: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      purchases: purchases.map((row) => ({
        id: row.id,
        number: row.number,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        missingField: 'purchaseDate',
      })),
      inventoryMovements: movements.map((row) => ({
        id: row.id,
        type: row.type,
        referenceType: row.referenceType,
        referenceId: row.referenceId,
        createdAt: row.createdAt.toISOString(),
        missingField: 'transactionDate',
      })),
      summary: {
        purchasesWithoutDate: purchases.length,
        movementsWithoutTransactionDate: movements.length,
        note: 'Существующие приходы сохранили warehouseReceiptDate при переименовании. Проверьте и при необходимости исправьте исторические даты вручную.',
      },
    };
  }
}

function reportMonthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function reportMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-');
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return new Intl.DateTimeFormat('ru-RU', {
    month: 'long',
    year: 'numeric',
  }).format(date);
}

type PurchaseProductBucket = {
  productId: string;
  productName: string;
  productCode: string;
  unit: string;
  quantity: Prisma.Decimal;
  totalAmountKgs: Prisma.Decimal;
  purchaseCostKgs: Prisma.Decimal;
};

function addPurchaseProductBucket(
  products: Map<string, PurchaseProductBucket>,
  item: {
    productId: string;
    quantity: Prisma.Decimal;
    estimatedLandedCostKgs: Prisma.Decimal;
    purchaseCostKgs: Prisma.Decimal;
    product: { id: string; name: string; code: string; unit: string };
  },
) {
  if (!products.has(item.productId)) {
    products.set(item.productId, {
      productId: item.productId,
      productName: item.product.name,
      productCode: item.product.code,
      unit: item.product.unit,
      quantity: new Prisma.Decimal(0),
      totalAmountKgs: new Prisma.Decimal(0),
      purchaseCostKgs: new Prisma.Decimal(0),
    });
  }

  const bucket = products.get(item.productId)!;
  bucket.quantity = bucket.quantity.plus(item.quantity);
  bucket.totalAmountKgs = bucket.totalAmountKgs.plus(item.estimatedLandedCostKgs);
  bucket.purchaseCostKgs = bucket.purchaseCostKgs.plus(item.purchaseCostKgs);
}

function serializePurchaseProductBuckets(
  products: Map<string, PurchaseProductBucket>,
) {
  return Array.from(products.values())
    .sort((a, b) => a.productName.localeCompare(b.productName, 'ru'))
    .map((product) => ({
      productId: product.productId,
      productName: product.productName,
      productCode: product.productCode,
      unit: product.unit,
      quantity: publicDecimal(product.quantity),
      totalAmountKgs: publicDecimal(product.totalAmountKgs),
      purchaseCostKgs: publicDecimal(product.purchaseCostKgs),
      unitCostKgs: publicDecimal(
        product.quantity.gt(0)
          ? product.totalAmountKgs.div(product.quantity)
          : new Prisma.Decimal(0),
      ),
    }));
}

function movementTypeLabel(type: InventoryMovementType): string {
  switch (type) {
    case 'PURCHASE_RECEIPT':
      return 'Приход';
    default:
      return type;
  }
}
