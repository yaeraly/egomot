import { Injectable } from '@nestjs/common';
import { InventoryMovementType, Prisma } from '@prisma/client';
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
    const rows = await this.prisma.purchase.findMany({
      where: {
        purchaseDate: businessDateRangeFilter(range.from, range.to),
      },
      include: { supplier: true },
      orderBy: [{ purchaseDate: 'desc' }, { number: 'desc' }],
    });

    return {
      range: { preset: range.preset, from: range.fromIso, to: range.toIso },
      rows: rows.map((row) => ({
        purchaseDate: formatBusinessDate(row.purchaseDate),
        supplierName: row.supplier.name,
        number: row.number,
        totalQuantity: publicDecimal(row.totalQuantity),
        totalPurchaseCny: publicDecimal(row.totalPurchaseCny),
        totalLogisticsKgs: publicDecimal(row.totalLogisticsKgs),
        estimatedTotalLandedCostKgs: publicDecimal(row.estimatedTotalLandedCostKgs),
        status: row.status,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async receiptReport(query: ReportDateQueryDto) {
    const range = this.resolveRange(query);
    const rows = await this.prisma.purchaseReceipt.findMany({
      where: {
        receiptDate: businessDateRangeFilter(range.from, range.to),
        status: 'COMPLETED',
      },
      include: {
        purchase: true,
        supplier: true,
        receivedBy: { select: { id: true, name: true } },
        discrepancies: true,
      },
      orderBy: [{ receiptDate: 'desc' }, { number: 'desc' }],
    });

    return {
      range: { preset: range.preset, from: range.fromIso, to: range.toIso },
      rows: rows.map((row) => {
        const shortage = row.discrepancies
          .filter((d) => d.type === 'SHORTAGE')
          .reduce((sum, d) => sum.plus(d.difference.abs()), new Prisma.Decimal(0));
        const excess = row.discrepancies
          .filter((d) => d.type === 'EXCESS')
          .reduce((sum, d) => sum.plus(d.difference), new Prisma.Decimal(0));

        return {
          receiptDate: formatBusinessDate(row.receiptDate),
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

  async missingBusinessDates() {
    const [purchases, movements] = await Promise.all([
      this.prisma.purchase.findMany({
        where: { purchaseDate: null },
        select: { id: true, number: true, createdAt: true, status: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.inventoryMovement.findMany({
        where: { transactionDate: null },
        select: { id: true, type: true, createdAt: true, referenceType: true, referenceId: true },
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
        note:
          'Существующие приходы сохранили receiptDate при переименовании arrivalDate. Проверьте и при необходимости исправьте исторические даты вручную.',
      },
    };
  }
}

function movementTypeLabel(type: InventoryMovementType): string {
  switch (type) {
    case 'PURCHASE_RECEIPT':
      return 'Приход';
    default:
      return type;
  }
}
