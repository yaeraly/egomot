import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Currency,
  LogisticsType,
  Prisma,
  PurchaseStatus,
} from '@prisma/client';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { publicDecimal } from '../common/decimal.util';
import {
  businessDateRangeFilter,
  formatBusinessDate,
  parseBusinessDate,
  resolveDateRange,
} from '../common/date.util';
import {
  calculatePurchase,
  PurchaseCalculation,
  PurchaseValidationError,
} from './purchase-calc';
import { validatePurchaseInput } from './purchase-validate';
import {
  assertValidStatus,
  buildPurchaseAuditEvents,
  ItemSnapshot,
  LogisticsSnapshot,
  PurchaseSnapshot,
} from './purchase-audit';
import { ChangeStatusDto, UpsertPurchaseDto } from './dto/purchase.dto';
import {
  productPurchasePriceHistoryValues,
  shouldSyncProductPurchasePrice,
} from './product-purchase-price.sync';

@Injectable()
export class PurchasesService {
  constructor(private readonly prisma: PrismaService) {}

  private runCalc(dto: UpsertPurchaseDto): PurchaseCalculation {
    try {
      validatePurchaseInput(dto);
      return calculatePurchase(dto);
    } catch (error) {
      if (error instanceof PurchaseValidationError) {
        throw new BadRequestException({
          message: error.messages,
          errors: error.messages,
        });
      }
      throw error;
    }
  }

  private serialize(purchase: {
    exchangeRateCnyToKgs: Prisma.Decimal;
    totalQuantity: Prisma.Decimal;
    totalWeightKg: Prisma.Decimal;
    totalPurchaseCny: Prisma.Decimal;
    totalPurchaseCostKgs: Prisma.Decimal;
    totalChinaTransportKgs: Prisma.Decimal;
    totalCargoKgs: Prisma.Decimal;
    totalKgInternalTransportKgs: Prisma.Decimal;
    totalOtherLogisticsKgs: Prisma.Decimal;
    totalLogisticsKgs: Prisma.Decimal;
    estimatedTotalLandedCostKgs: Prisma.Decimal;
    averageLogisticsCostPerKg: Prisma.Decimal;
    items?: Array<Record<string, unknown>>;
    logistics?: Array<Record<string, unknown>>;
    [key: string]: unknown;
  }) {
    const decimalKeys = [
      'exchangeRateCnyToKgs',
      'totalQuantity',
      'totalWeightKg',
      'totalPurchaseCny',
      'totalPurchaseCostKgs',
      'totalChinaTransportKgs',
      'totalCargoKgs',
      'totalKgInternalTransportKgs',
      'totalOtherLogisticsKgs',
      'totalLogisticsKgs',
      'estimatedTotalLandedCostKgs',
      'averageLogisticsCostPerKg',
    ] as const;

    const result: Record<string, unknown> = { ...purchase };
    result.purchaseDate = formatBusinessDate(purchase.purchaseDate as Date | null);
    for (const key of decimalKeys) {
      const value = purchase[key];
      result[key] = value != null ? publicDecimal(value) : value;
    }

    if (purchase.items) {
      result.items = purchase.items.map((item) => this.serializeItem(item));
    }
    if (purchase.logistics) {
      result.logistics = purchase.logistics.map((row) => this.serializeLogistics(row));
    }
    return result;
  }

  private serializeItem(item: Record<string, unknown>) {
    const keys = [
      'quantity',
      'unitPriceCny',
      'totalCny',
      'unitWeightKg',
      'totalWeightKg',
      'exchangeRateCnyToKgs',
      'purchaseCostKgs',
      'allocatedChinaTransportKgs',
      'allocatedCargoKgs',
      'allocatedKgInternalTransportKgs',
      'allocatedOtherLogisticsKgs',
      'totalAllocatedLogisticsKgs',
      'estimatedLandedCostKgs',
      'estimatedUnitLandedCostKgs',
    ];
    const result = { ...item };
    for (const key of keys) {
      const value = item[key];
      if (value !== undefined && value !== null) {
        result[key] = publicDecimal(value as Prisma.Decimal);
      }
    }
    return result;
  }

  private serializeLogistics(row: Record<string, unknown>) {
    return {
      ...row,
      amount: publicDecimal(row.amount as Prisma.Decimal),
      exchangeRate: row.exchangeRate ? publicDecimal(row.exchangeRate as Prisma.Decimal) : null,
      amountKgs: publicDecimal(row.amountKgs as Prisma.Decimal),
    };
  }

  private include() {
    return {
      supplier: true,
      items: { include: { product: { include: { category: true } } }, orderBy: { createdAt: 'asc' as const } },
      logistics: { orderBy: { createdAt: 'asc' as const } },
    };
  }

  async list(
    status?: string,
    supplierId?: string,
    search?: string,
    preset?: string,
    from?: string,
    to?: string,
  ) {
    const where: Prisma.PurchaseWhereInput = {};
    if (status) {
      assertValidStatus(status);
      where.status = status as PurchaseStatus;
    }
    if (supplierId) where.supplierId = supplierId;
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { number: { contains: q, mode: 'insensitive' } },
        { supplier: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }
    const range = resolveDateRange({ preset, from, to });
    if (range) {
      where.purchaseDate = businessDateRangeFilter(range.from, range.to);
    }
    const rows = await this.prisma.purchase.findMany({
      where,
      include: { supplier: true },
      orderBy: [{ purchaseDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.serialize(row));
  }

  async get(id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: this.include(),
    });
    if (!purchase) throw new NotFoundException('Закупка не найдена');
    return this.serialize(purchase);
  }

  preview(dto: UpsertPurchaseDto) {
    const calc = this.runCalc(dto);
    return {
      items: calc.items.map((item) => ({
        ...item,
        quantity: item.quantity.toFixed(3),
        unitPriceCny: item.unitPriceCny.toFixed(4),
        totalCny: item.totalCny.toFixed(2),
        unitWeightKg: item.unitWeightKg.toFixed(3),
        totalWeightKg: item.totalWeightKg.toFixed(3),
        exchangeRateCnyToKgs: item.exchangeRateCnyToKgs.toFixed(6),
        purchaseCostKgs: item.purchaseCostKgs.toFixed(2),
        allocatedChinaTransportKgs: item.allocatedChinaTransportKgs.toFixed(2),
        allocatedCargoKgs: item.allocatedCargoKgs.toFixed(2),
        allocatedKgInternalTransportKgs: item.allocatedKgInternalTransportKgs.toFixed(2),
        allocatedOtherLogisticsKgs: item.allocatedOtherLogisticsKgs.toFixed(2),
        totalAllocatedLogisticsKgs: item.totalAllocatedLogisticsKgs.toFixed(2),
        estimatedLandedCostKgs: item.estimatedLandedCostKgs.toFixed(2),
        estimatedUnitLandedCostKgs: item.estimatedUnitLandedCostKgs.toFixed(4),
      })),
      logistics: calc.logistics.map((row) => ({
        ...row,
        amount: row.amount.toFixed(2),
        exchangeRate: row.exchangeRate ? row.exchangeRate.toFixed(6) : null,
        amountKgs: row.amountKgs.toFixed(2),
      })),
      totals: {
        totalPositions: calc.totals.totalPositions,
        totalQuantity: calc.totals.totalQuantity.toFixed(3),
        totalWeightKg: calc.totals.totalWeightKg.toFixed(3),
        totalPurchaseCny: calc.totals.totalPurchaseCny.toFixed(2),
        totalPurchaseCostKgs: calc.totals.totalPurchaseCostKgs.toFixed(2),
        totalChinaTransportKgs: calc.totals.totalChinaTransportKgs.toFixed(2),
        totalCargoKgs: calc.totals.totalCargoKgs.toFixed(2),
        totalKgInternalTransportKgs: calc.totals.totalKgInternalTransportKgs.toFixed(2),
        totalOtherLogisticsKgs: calc.totals.totalOtherLogisticsKgs.toFixed(2),
        totalLogisticsKgs: calc.totals.totalLogisticsKgs.toFixed(2),
        estimatedTotalLandedCostKgs: calc.totals.estimatedTotalLandedCostKgs.toFixed(2),
        averageLogisticsCostPerKg: calc.totals.averageLogisticsCostPerKg.toFixed(4),
        exchangeRateCnyToKgs: calc.totals.exchangeRateCnyToKgs.toFixed(6),
      },
    };
  }

  private async nextNumber(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `ZG-${year}-`;
    const last = await tx.purchase.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
    });
    const match = last?.number.match(/ZG-\d{4}-(\d+)$/);
    const current = match ? Number(match[1]) : 0;
    return `${prefix}${String(current + 1).padStart(4, '0')}`;
  }

  private async assertRefs(dto: UpsertPurchaseDto) {
    const supplier = await this.prisma.supplier.findUnique({ where: { id: dto.supplierId } });
    if (!supplier) throw new BadRequestException('Поставщик не найден');
    const ids = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({ where: { id: { in: ids } } });
    if (products.length !== new Set(ids).size) {
      throw new BadRequestException('Один или несколько товаров не найдены');
    }
  }

  private totalsData(calc: PurchaseCalculation) {
    return {
      exchangeRateCnyToKgs: calc.totals.exchangeRateCnyToKgs.toFixed(6),
      totalPositions: calc.totals.totalPositions,
      totalQuantity: calc.totals.totalQuantity.toFixed(3),
      totalWeightKg: calc.totals.totalWeightKg.toFixed(3),
      totalPurchaseCny: calc.totals.totalPurchaseCny.toFixed(2),
      totalPurchaseCostKgs: calc.totals.totalPurchaseCostKgs.toFixed(2),
      totalChinaTransportKgs: calc.totals.totalChinaTransportKgs.toFixed(2),
      totalCargoKgs: calc.totals.totalCargoKgs.toFixed(2),
      totalKgInternalTransportKgs: calc.totals.totalKgInternalTransportKgs.toFixed(2),
      totalOtherLogisticsKgs: calc.totals.totalOtherLogisticsKgs.toFixed(2),
      totalLogisticsKgs: calc.totals.totalLogisticsKgs.toFixed(2),
      estimatedTotalLandedCostKgs: calc.totals.estimatedTotalLandedCostKgs.toFixed(2),
      averageLogisticsCostPerKg: calc.totals.averageLogisticsCostPerKg.toFixed(4),
    };
  }

  private itemData(purchaseId: string, item: PurchaseCalculation['items'][number]) {
    return {
      purchaseId,
      productId: item.productId,
      quantity: item.quantity.toFixed(3),
      unitPriceCny: item.unitPriceCny.toFixed(4),
      totalCny: item.totalCny.toFixed(2),
      unitWeightKg: item.unitWeightKg.toFixed(3),
      totalWeightKg: item.totalWeightKg.toFixed(3),
      exchangeRateCnyToKgs: item.exchangeRateCnyToKgs.toFixed(6),
      purchaseCostKgs: item.purchaseCostKgs.toFixed(2),
      allocatedChinaTransportKgs: item.allocatedChinaTransportKgs.toFixed(2),
      allocatedCargoKgs: item.allocatedCargoKgs.toFixed(2),
      allocatedKgInternalTransportKgs: item.allocatedKgInternalTransportKgs.toFixed(2),
      allocatedOtherLogisticsKgs: item.allocatedOtherLogisticsKgs.toFixed(2),
      totalAllocatedLogisticsKgs: item.totalAllocatedLogisticsKgs.toFixed(2),
      estimatedLandedCostKgs: item.estimatedLandedCostKgs.toFixed(2),
      estimatedUnitLandedCostKgs: item.estimatedUnitLandedCostKgs.toFixed(4),
    };
  }

  private logisticsData(purchaseId: string, row: PurchaseCalculation['logistics'][number]) {
    return {
      purchaseId,
      type: row.type as LogisticsType,
      amount: row.amount.toFixed(2),
      currency: row.currency as Currency,
      exchangeRate: row.exchangeRate ? row.exchangeRate.toFixed(6) : null,
      amountKgs: row.amountKgs.toFixed(2),
      comment: row.comment,
    };
  }

  private snapshotFromRecord(purchase: {
    id: string;
    supplierId: string;
    status: PurchaseStatus;
    exchangeRateCnyToKgs: Prisma.Decimal;
    notes: string | null;
    items: Array<{
      productId: string;
      quantity: Prisma.Decimal;
      unitPriceCny: Prisma.Decimal;
      unitWeightKg: Prisma.Decimal;
      exchangeRateCnyToKgs: Prisma.Decimal;
    }>;
    logistics: Array<{
      id: string;
      type: LogisticsType;
      amount: Prisma.Decimal;
      currency: Currency;
      exchangeRate: Prisma.Decimal | null;
      amountKgs: Prisma.Decimal;
      comment: string | null;
    }>;
  }): PurchaseSnapshot {
    return {
      id: purchase.id,
      supplierId: purchase.supplierId,
      status: purchase.status,
      exchangeRateCnyToKgs: publicDecimal(purchase.exchangeRateCnyToKgs),
      notes: purchase.notes,
      items: purchase.items.map(
        (item): ItemSnapshot => ({
          productId: item.productId,
          quantity: publicDecimal(item.quantity),
          unitPriceCny: publicDecimal(item.unitPriceCny),
          unitWeightKg: publicDecimal(item.unitWeightKg),
          exchangeRateCnyToKgs: publicDecimal(item.exchangeRateCnyToKgs),
        }),
      ),
      logistics: purchase.logistics.map(
        (row): LogisticsSnapshot => ({
          type: row.type,
          amount: publicDecimal(row.amount),
          currency: row.currency,
          exchangeRate: row.exchangeRate ? publicDecimal(row.exchangeRate) : null,
          amountKgs: publicDecimal(row.amountKgs),
          comment: row.comment,
        }),
      ),
    };
  }

  private async writeAudit(
    tx: Prisma.TransactionClient,
    userId: string,
    events: ReturnType<typeof buildPurchaseAuditEvents>,
  ) {
    if (events.length === 0) return;
    await tx.auditLog.createMany({
      data: events.map((event) => ({
        userId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        oldValue: event.oldValue === undefined ? Prisma.JsonNull : (event.oldValue as Prisma.InputJsonValue),
        newValue: event.newValue === undefined ? Prisma.JsonNull : (event.newValue as Prisma.InputJsonValue),
      })),
    });
  }

  private async syncProductPurchasePrices(
    tx: Prisma.TransactionClient,
    userId: string,
    purchaseId: string,
    items: PurchaseCalculation['items'],
  ) {
    for (const item of items) {
      const product = await tx.product.findUniqueOrThrow({
        where: { id: item.productId },
      });
      if (
        !shouldSyncProductPurchasePrice(
          product.defaultPurchasePriceCny,
          item.unitPriceCny,
        )
      ) {
        continue;
      }

      const values = productPurchasePriceHistoryValues(
        product.defaultPurchasePriceCny,
        item.unitPriceCny,
      );

      await tx.productPurchasePriceHistory.create({
        data: {
          productId: item.productId,
          purchaseId,
          previousPriceCny: values.previousPriceCny,
          newPriceCny: values.newPriceCny,
          changedByUserId: userId,
        },
      });

      await tx.product.update({
        where: { id: item.productId },
        data: { defaultPurchasePriceCny: values.defaultPurchasePriceCny },
      });
    }
  }

  async create(user: User, dto: UpsertPurchaseDto) {
    await this.assertRefs(dto);
    const calc = this.runCalc(dto);
    const purchaseDate = parseBusinessDate(dto.purchaseDate, 'Дата закупки');

    const created = await this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.create({
        data: {
          number: await this.nextNumber(tx),
          supplierId: dto.supplierId,
          purchaseDate,
          status: PurchaseStatus.DRAFT,
          notes: dto.notes?.trim() || null,
          ...this.totalsData(calc),
        },
      });

      await tx.purchaseItem.createMany({
        data: calc.items.map((item) => this.itemData(purchase.id, item)),
      });
      await this.syncProductPurchasePrices(tx, user.id, purchase.id, calc.items);
      if (calc.logistics.length > 0) {
        await tx.purchaseLogisticsExpense.createMany({
          data: calc.logistics.map((row) => this.logisticsData(purchase.id, row)),
        });
      }

      const full = await tx.purchase.findUniqueOrThrow({
        where: { id: purchase.id },
        include: this.include(),
      });

      await this.writeAudit(
        tx,
        user.id,
        buildPurchaseAuditEvents({
          purchaseId: purchase.id,
          previous: null,
          next: this.snapshotFromRecord(full),
        }),
      );

      return full;
    });

    return this.serialize(created);
  }

  async update(user: User, id: string, dto: UpsertPurchaseDto) {
    const existing = await this.prisma.purchase.findUnique({
      where: { id },
      include: this.include(),
    });
    if (!existing) throw new NotFoundException('Закупка не найдена');

    await this.assertRefs(dto);
    const calc = this.runCalc(dto);
    const purchaseDate = parseBusinessDate(dto.purchaseDate, 'Дата закупки');
    const previous = this.snapshotFromRecord(existing);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      await tx.purchaseLogisticsExpense.deleteMany({ where: { purchaseId: id } });

      await tx.purchase.update({
        where: { id },
        data: {
          supplierId: dto.supplierId,
          purchaseDate,
          notes: dto.notes?.trim() || null,
          ...this.totalsData(calc),
        },
      });

      await tx.purchaseItem.createMany({
        data: calc.items.map((item) => this.itemData(id, item)),
      });
      await this.syncProductPurchasePrices(tx, user.id, id, calc.items);
      if (calc.logistics.length > 0) {
        await tx.purchaseLogisticsExpense.createMany({
          data: calc.logistics.map((row) => this.logisticsData(id, row)),
        });
      }

      const full = await tx.purchase.findUniqueOrThrow({
        where: { id },
        include: this.include(),
      });

      await this.writeAudit(
        tx,
        user.id,
        buildPurchaseAuditEvents({
          purchaseId: id,
          previous,
          next: this.snapshotFromRecord(full),
        }),
      );

      return full;
    });

    return this.serialize(updated);
  }

  async changeStatus(user: User, id: string, dto: ChangeStatusDto) {
    assertValidStatus(dto.status);
    const existing = await this.prisma.purchase.findUnique({
      where: { id },
      include: this.include(),
    });
    if (!existing) throw new NotFoundException('Закупка не найдена');
    if (existing.status === dto.status) {
      return this.serialize(existing);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const purchase = await tx.purchase.update({
        where: { id },
        data: { status: dto.status },
        include: this.include(),
      });
      await this.writeAudit(
        tx,
        user.id,
        buildPurchaseAuditEvents({
          purchaseId: id,
          previous: this.snapshotFromRecord(existing),
          next: this.snapshotFromRecord(purchase),
        }),
      );
      return purchase;
    });

    return this.serialize(updated);
  }

  async auditLogs(id: string) {
    await this.get(id);
    return this.prisma.auditLog.findMany({
      where: { entityId: id },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
