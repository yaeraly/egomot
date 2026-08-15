import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  InventoryReferenceType,
  InventoryMovementType,
  Prisma,
  PurchaseReceiptStatus,
  PurchaseStatus,
  ReceiptDiscrepancyType,
} from '@prisma/client';
import type { User } from '@prisma/client';
import { publicDecimal } from '../common/decimal.util';
import {
  assertReceiptNotBeforePurchase,
  businessDateRangeFilter,
  formatBusinessDate,
  parseBusinessDate,
  resolveDateRange,
} from '../common/date.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  calculateReceipt,
  computeInventoryAfterReceipt,
  PurchaseValidationError,
  ReceiptCalculation,
} from './receipt-calc';
import { RECEIPT_AUDIT_ACTIONS } from './receipt-audit';
import {
  CompletePurchaseReceiptDto,
  CreatePurchaseReceiptDto,
  UpdatePurchaseReceiptDto,
} from './dto/purchase-receipt.dto';

const EDITABLE_RECEIPT_STATUSES: PurchaseReceiptStatus[] = [
  PurchaseReceiptStatus.DRAFT,
  PurchaseReceiptStatus.RECEIVING,
];

@Injectable()
export class PurchaseReceiptsService {
  constructor(private readonly prisma: PrismaService) {}

  private include() {
    return {
      purchase: { include: { supplier: true } },
      supplier: true,
      receivedBy: { select: { id: true, name: true, email: true, role: true } },
      items: {
        include: { product: { include: { category: true } }, purchaseItem: true },
        orderBy: { createdAt: 'asc' as const },
      },
      discrepancies: {
        include: { product: true },
        orderBy: { createdAt: 'asc' as const },
      },
    };
  }

  private runCalc(params: {
    exchangeRateCnyToKgs: Prisma.Decimal | string | number;
    items: Array<{
      productId: string;
      orderedQuantity: Prisma.Decimal | string | number;
      receivedQuantity: Prisma.Decimal | string | number;
      unitPriceCny: Prisma.Decimal | string | number;
      unitWeightKg: Prisma.Decimal | string | number;
    }>;
    transport: {
      chinaInternalTransportKgs: Prisma.Decimal | string | number;
      cargoKgs: Prisma.Decimal | string | number;
      kyrgyzstanInternalTransportKgs: Prisma.Decimal | string | number;
    };
  }): ReceiptCalculation {
    try {
      return calculateReceipt({
        exchangeRateCnyToKgs: String(params.exchangeRateCnyToKgs),
        items: params.items.map((item) => ({
          productId: item.productId,
          orderedQuantity: String(item.orderedQuantity),
          receivedQuantity: String(item.receivedQuantity),
          unitPriceCny: String(item.unitPriceCny),
          unitWeightKg: String(item.unitWeightKg),
        })),
        transport: {
          chinaInternalTransportKgs: String(params.transport.chinaInternalTransportKgs),
          cargoKgs: String(params.transport.cargoKgs),
          kyrgyzstanInternalTransportKgs: String(params.transport.kyrgyzstanInternalTransportKgs),
        },
      });
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

  private serializeReceipt(receipt: Record<string, unknown>) {
    const decimalKeys = [
      'exchangeRateCnyToKgs',
      'chinaInternalTransportKgs',
      'cargoKgs',
      'kyrgyzstanInternalTransportKgs',
      'totalTransportKgs',
      'totalOrderedQuantity',
      'totalReceivedQuantity',
      'totalDifference',
      'totalLandedCostKgs',
    ] as const;

    const result: Record<string, unknown> = { ...receipt };
    result.receiptDate = formatBusinessDate(receipt.receiptDate as Date);
    if (result.purchase && typeof result.purchase === 'object') {
      const purchase = result.purchase as Record<string, unknown>;
      purchase.purchaseDate = formatBusinessDate(purchase.purchaseDate as Date | null);
    }
    for (const key of decimalKeys) {
      const value = receipt[key];
      if (value != null) result[key] = publicDecimal(value as Prisma.Decimal);
    }

    if (receipt.items) {
      result.items = (receipt.items as Array<Record<string, unknown>>).map((item) =>
        this.serializeItem(item),
      );
    }
    if (receipt.discrepancies) {
      result.discrepancies = (receipt.discrepancies as Array<Record<string, unknown>>).map(
        (row) => this.serializeDiscrepancy(row),
      );
    }
    return result;
  }

  private serializeItem(item: Record<string, unknown>) {
    const keys = [
      'orderedQuantity',
      'receivedQuantity',
      'difference',
      'unitPriceCny',
      'unitWeightKg',
      'totalWeightKg',
      'purchaseCostKgs',
      'allocatedChinaTransportKgs',
      'allocatedCargoKgs',
      'allocatedKgInternalTransportKgs',
      'totalAllocatedTransportKgs',
      'unitLandedCostKgs',
      'totalLandedCostKgs',
    ];
    const result = { ...item };
    for (const key of keys) {
      const value = item[key];
      if (value != null) result[key] = publicDecimal(value as Prisma.Decimal);
    }
    return result;
  }

  private serializeDiscrepancy(row: Record<string, unknown>) {
    const keys = ['orderedQuantity', 'receivedQuantity', 'difference'];
    const result = { ...row };
    for (const key of keys) {
      const value = row[key];
      if (value != null) result[key] = publicDecimal(value as Prisma.Decimal);
    }
    return result;
  }

  private async nextNumber(tx: Prisma.TransactionClient): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `PR-${year}-`;
    const last = await tx.purchaseReceipt.findFirst({
      where: { number: { startsWith: prefix } },
      orderBy: { number: 'desc' },
    });
    const match = last?.number.match(/PR-\d{4}-(\d+)$/);
    const current = match ? Number(match[1]) : 0;
    return `${prefix}${String(current + 1).padStart(4, '0')}`;
  }

  private async assertPurchaseReceivable(purchaseId: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id: purchaseId },
      include: { items: true, logistics: true },
    });
    if (!purchase) throw new NotFoundException('Закупка не найдена');

    if (
      purchase.status === PurchaseStatus.RECEIVED ||
      purchase.status === PurchaseStatus.RECEIVED_WITH_DISCREPANCY
    ) {
      throw new BadRequestException('Закупка уже полностью принята на склад');
    }

    if (purchase.status === PurchaseStatus.DRAFT) {
      throw new BadRequestException('Нельзя принять черновик закупки');
    }

    const activeReceipt = await this.prisma.purchaseReceipt.findFirst({
      where: {
        purchaseId,
        status: { in: [PurchaseReceiptStatus.DRAFT, PurchaseReceiptStatus.RECEIVING] },
      },
    });
    if (activeReceipt) {
      throw new BadRequestException(
        `Для этой закупки уже есть активный приход ${activeReceipt.number}`,
      );
    }

    return purchase;
  }

  private transportFromPurchase(purchase: {
    totalChinaTransportKgs: Prisma.Decimal;
    totalCargoKgs: Prisma.Decimal;
    totalKgInternalTransportKgs: Prisma.Decimal;
  }) {
    return {
      chinaInternalTransportKgs: purchase.totalChinaTransportKgs,
      cargoKgs: purchase.totalCargoKgs,
      kyrgyzstanInternalTransportKgs: purchase.totalKgInternalTransportKgs,
    };
  }

  private applyCalcToReceiptData(calc: ReceiptCalculation) {
    return {
      exchangeRateCnyToKgs: calc.totals.exchangeRateCnyToKgs.toFixed(6),
      chinaInternalTransportKgs: calc.totals.chinaInternalTransportKgs.toFixed(2),
      cargoKgs: calc.totals.cargoKgs.toFixed(2),
      kyrgyzstanInternalTransportKgs: calc.totals.kyrgyzstanInternalTransportKgs.toFixed(2),
      totalTransportKgs: calc.totals.totalTransportKgs.toFixed(2),
      totalOrderedQuantity: calc.totals.totalOrderedQuantity.toFixed(3),
      totalReceivedQuantity: calc.totals.totalReceivedQuantity.toFixed(3),
      totalDifference: calc.totals.totalDifference.toFixed(3),
      totalLandedCostKgs: calc.totals.totalLandedCostKgs.toFixed(2),
    };
  }

  private itemDataFromCalc(
    purchaseItemId: string,
    calcItem: ReceiptCalculation['items'][number],
  ) {
    return {
      purchaseItemId,
      productId: calcItem.productId,
      orderedQuantity: calcItem.orderedQuantity.toFixed(3),
      receivedQuantity: calcItem.receivedQuantity.toFixed(3),
      difference: calcItem.difference.toFixed(3),
      unitPriceCny: calcItem.unitPriceCny.toFixed(4),
      unitWeightKg: calcItem.unitWeightKg.toFixed(3),
      totalWeightKg: calcItem.totalWeightKg.toFixed(3),
      purchaseCostKgs: calcItem.purchaseCostKgs.toFixed(2),
      allocatedChinaTransportKgs: calcItem.allocatedChinaTransportKgs.toFixed(2),
      allocatedCargoKgs: calcItem.allocatedCargoKgs.toFixed(2),
      allocatedKgInternalTransportKgs: calcItem.allocatedKgInternalTransportKgs.toFixed(2),
      totalAllocatedTransportKgs: calcItem.totalAllocatedTransportKgs.toFixed(2),
      unitLandedCostKgs: calcItem.unitLandedCostKgs.toFixed(4),
      totalLandedCostKgs: calcItem.totalLandedCostKgs.toFixed(2),
    };
  }

  async list(status?: string, purchaseId?: string, search?: string, preset?: string, from?: string, to?: string) {
    const where: Prisma.PurchaseReceiptWhereInput = {};
    if (status) where.status = status as PurchaseReceiptStatus;
    if (purchaseId) where.purchaseId = purchaseId;
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { number: { contains: q, mode: 'insensitive' } },
        { purchase: { number: { contains: q, mode: 'insensitive' } } },
        { supplier: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }
    const range = resolveDateRange({ preset, from, to });
    if (range) {
      where.receiptDate = businessDateRangeFilter(range.from, range.to);
    }

    const rows = await this.prisma.purchaseReceipt.findMany({
      where,
      include: this.include(),
      orderBy: [{ receiptDate: 'desc' }, { createdAt: 'desc' }],
    });
    return rows.map((row) => this.serializeReceipt(row as unknown as Record<string, unknown>));
  }

  async get(id: string) {
    const receipt = await this.prisma.purchaseReceipt.findUnique({
      where: { id },
      include: this.include(),
    });
    if (!receipt) throw new NotFoundException('Приход не найден');
    return this.serializeReceipt(receipt as unknown as Record<string, unknown>);
  }

  async create(user: User, purchaseId: string, dto: CreatePurchaseReceiptDto) {
    const purchase = await this.assertPurchaseReceivable(purchaseId);
    if (purchase.items.length === 0) {
      throw new BadRequestException('В закупке нет товаров');
    }
    if (!purchase.purchaseDate) {
      throw new BadRequestException(
        'У закупки не указана дата закупки. Укажите дату закупки перед приёмом.',
      );
    }

    const transport = this.transportFromPurchase(purchase);
    const receiptDate = parseBusinessDate(dto.receiptDate, 'Дата поступления');
    assertReceiptNotBeforePurchase(receiptDate, purchase.purchaseDate);

    const calc = this.runCalc({
      exchangeRateCnyToKgs: purchase.exchangeRateCnyToKgs,
      items: purchase.items.map((item) => ({
        productId: item.productId,
        orderedQuantity: item.quantity,
        receivedQuantity: item.quantity,
        unitPriceCny: item.unitPriceCny,
        unitWeightKg: item.unitWeightKg,
      })),
      transport,
    });

    const receipt = await this.prisma.$transaction(async (tx) => {
      const created = await tx.purchaseReceipt.create({
        data: {
          number: await this.nextNumber(tx),
          purchaseId: purchase.id,
          supplierId: purchase.supplierId,
          receiptDate,
          receivedByUserId: user.id,
          status: PurchaseReceiptStatus.DRAFT,
          comment: dto.comment ?? null,
          ...this.applyCalcToReceiptData(calc),
          items: {
            create: purchase.items.map((purchaseItem) => {
              const calcItem = calc.items.find((i) => i.productId === purchaseItem.productId)!;
              return this.itemDataFromCalc(purchaseItem.id, calcItem);
            }),
          },
        },
        include: this.include(),
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: RECEIPT_AUDIT_ACTIONS.RECEIPT_CREATED,
          entityType: 'PurchaseReceipt',
          entityId: created.id,
          oldValue: Prisma.JsonNull,
          newValue: {
            number: created.number,
            purchaseId: purchase.id,
            purchaseNumber: purchase.number,
            status: created.status,
          },
        },
      });

      return created;
    });

    return this.serializeReceipt(receipt as unknown as Record<string, unknown>);
  }

  async update(user: User, id: string, dto: UpdatePurchaseReceiptDto) {
    const receipt = await this.prisma.purchaseReceipt.findUnique({
      where: { id },
      include: { items: true, purchase: { include: { items: true } } },
    });
    if (!receipt) throw new NotFoundException('Приход не найден');
    if (!EDITABLE_RECEIPT_STATUSES.includes(receipt.status)) {
      throw new ForbiddenException('Завершённый приход нельзя редактировать');
    }

    const itemMap = new Map(receipt.items.map((item) => [item.productId, item]));
    const updatedItems = receipt.items.map((item) => {
      const patch = dto.items?.find((row) => row.productId === item.productId);
      return {
        productId: item.productId,
        orderedQuantity: item.orderedQuantity,
        receivedQuantity: patch?.receivedQuantity ?? item.receivedQuantity,
        unitPriceCny: item.unitPriceCny,
        unitWeightKg: item.unitWeightKg,
        purchaseItemId: item.purchaseItemId,
        id: item.id,
      };
    });

    if (dto.items) {
      for (const patch of dto.items) {
        if (!itemMap.has(patch.productId)) {
          throw new BadRequestException('Товар не принадлежит этой закупке');
        }
        const purchaseItem = receipt.purchase.items.find((pi) => pi.productId === patch.productId);
        if (!purchaseItem) {
          throw new BadRequestException('Товар не принадлежит закупке');
        }
      }
    }

    const transport = {
      chinaInternalTransportKgs:
        dto.transport?.chinaInternalTransportKgs ?? receipt.chinaInternalTransportKgs,
      cargoKgs: dto.transport?.cargoKgs ?? receipt.cargoKgs,
      kyrgyzstanInternalTransportKgs:
        dto.transport?.kyrgyzstanInternalTransportKgs ?? receipt.kyrgyzstanInternalTransportKgs,
    };

    const calc = this.runCalc({
      exchangeRateCnyToKgs: receipt.exchangeRateCnyToKgs,
      items: updatedItems,
      transport,
    });

    const nextStatus =
      receipt.status === PurchaseReceiptStatus.DRAFT
        ? PurchaseReceiptStatus.RECEIVING
        : receipt.status;

    const nextReceiptDate = dto.receiptDate
      ? parseBusinessDate(dto.receiptDate, 'Дата поступления')
      : receipt.receiptDate;
    assertReceiptNotBeforePurchase(nextReceiptDate, receipt.purchase.purchaseDate);

    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.purchaseReceipt.update({
        where: { id },
        data: {
          receiptDate: nextReceiptDate,
          comment: dto.comment !== undefined ? dto.comment : receipt.comment,
          status: nextStatus,
          ...this.applyCalcToReceiptData(calc),
        },
      });

      for (const row of updatedItems) {
        const calcItem = calc.items.find((i) => i.productId === row.productId)!;
        await tx.purchaseReceiptItem.update({
          where: { id: row.id },
          data: this.itemDataFromCalc(row.purchaseItemId, calcItem),
        });
      }

      await tx.purchaseReceiptDiscrepancy.deleteMany({ where: { receiptId: id } });
      if (calc.discrepancies.length > 0) {
        await tx.purchaseReceiptDiscrepancy.createMany({
          data: calc.discrepancies.map((d) => ({
            receiptId: id,
            productId: d.productId,
            orderedQuantity: d.orderedQuantity.toFixed(3),
            receivedQuantity: d.receivedQuantity.toFixed(3),
            difference: d.difference.toFixed(3),
            type: d.type as ReceiptDiscrepancyType,
            comment: dto.items?.find((i) => i.productId === d.productId)?.comment ?? null,
          })),
        });
      }

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: RECEIPT_AUDIT_ACTIONS.RECEIPT_UPDATED,
          entityType: 'PurchaseReceipt',
          entityId: id,
          oldValue: { status: receipt.status },
          newValue: {
            status: nextStatus,
            totals: {
              totalReceivedQuantity: calc.totals.totalReceivedQuantity.toFixed(3),
              totalDifference: calc.totals.totalDifference.toFixed(3),
              totalLandedCostKgs: calc.totals.totalLandedCostKgs.toFixed(2),
            },
          },
        },
      });

      return tx.purchaseReceipt.findUnique({ where: { id }, include: this.include() });
    });

    return this.serializeReceipt(saved as unknown as Record<string, unknown>);
  }

  async calculate(id: string) {
    const receipt = await this.get(id);
    const calc = this.runCalc({
      exchangeRateCnyToKgs: receipt.exchangeRateCnyToKgs as string,
      items: (receipt.items as Array<Record<string, string>>).map((item) => ({
        productId: item.productId as string,
        orderedQuantity: item.orderedQuantity,
        receivedQuantity: item.receivedQuantity,
        unitPriceCny: item.unitPriceCny,
        unitWeightKg: item.unitWeightKg,
      })),
      transport: {
        chinaInternalTransportKgs: receipt.chinaInternalTransportKgs as string,
        cargoKgs: receipt.cargoKgs as string,
        kyrgyzstanInternalTransportKgs: receipt.kyrgyzstanInternalTransportKgs as string,
      },
    });

    return {
      items: calc.items.map((item) => ({
        productId: item.productId,
        orderedQuantity: item.orderedQuantity.toFixed(3),
        receivedQuantity: item.receivedQuantity.toFixed(3),
        difference: item.difference.toFixed(3),
        unitPriceCny: item.unitPriceCny.toFixed(4),
        unitWeightKg: item.unitWeightKg.toFixed(3),
        totalWeightKg: item.totalWeightKg.toFixed(3),
        purchaseCostKgs: item.purchaseCostKgs.toFixed(2),
        allocatedChinaTransportKgs: item.allocatedChinaTransportKgs.toFixed(2),
        allocatedCargoKgs: item.allocatedCargoKgs.toFixed(2),
        allocatedKgInternalTransportKgs: item.allocatedKgInternalTransportKgs.toFixed(2),
        totalAllocatedTransportKgs: item.totalAllocatedTransportKgs.toFixed(2),
        unitLandedCostKgs: item.unitLandedCostKgs.toFixed(4),
        totalLandedCostKgs: item.totalLandedCostKgs.toFixed(2),
      })),
      discrepancies: calc.discrepancies.map((d) => ({
        productId: d.productId,
        orderedQuantity: d.orderedQuantity.toFixed(3),
        receivedQuantity: d.receivedQuantity.toFixed(3),
        difference: d.difference.toFixed(3),
        type: d.type,
      })),
      totals: {
        totalOrderedQuantity: calc.totals.totalOrderedQuantity.toFixed(3),
        totalReceivedQuantity: calc.totals.totalReceivedQuantity.toFixed(3),
        totalDifference: calc.totals.totalDifference.toFixed(3),
        totalShortage: calc.totals.totalShortage.toFixed(3),
        totalExcess: calc.totals.totalExcess.toFixed(3),
        chinaInternalTransportKgs: calc.totals.chinaInternalTransportKgs.toFixed(2),
        cargoKgs: calc.totals.cargoKgs.toFixed(2),
        kyrgyzstanInternalTransportKgs: calc.totals.kyrgyzstanInternalTransportKgs.toFixed(2),
        totalTransportKgs: calc.totals.totalTransportKgs.toFixed(2),
        totalLandedCostKgs: calc.totals.totalLandedCostKgs.toFixed(2),
        totalWeightKg: calc.totals.totalWeightKg.toFixed(3),
        exchangeRateCnyToKgs: calc.totals.exchangeRateCnyToKgs.toFixed(6),
      },
    };
  }

  async complete(user: User, id: string, dto: CompletePurchaseReceiptDto) {
    const receipt = await this.prisma.purchaseReceipt.findUnique({
      where: { id },
      include: {
        items: { include: { product: true } },
        purchase: true,
        discrepancies: true,
      },
    });
    if (!receipt) throw new NotFoundException('Приход не найден');
    if (receipt.status === PurchaseReceiptStatus.COMPLETED) {
      throw new BadRequestException('Приход уже завершён');
    }
    if (receipt.status === PurchaseReceiptStatus.CANCELLED) {
      throw new BadRequestException('Нельзя завершить отменённый приход');
    }

    const calc = this.runCalc({
      exchangeRateCnyToKgs: receipt.exchangeRateCnyToKgs,
      items: receipt.items.map((item) => ({
        productId: item.productId,
        orderedQuantity: item.orderedQuantity,
        receivedQuantity: item.receivedQuantity,
        unitPriceCny: item.unitPriceCny,
        unitWeightKg: item.unitWeightKg,
      })),
      transport: {
        chinaInternalTransportKgs: receipt.chinaInternalTransportKgs,
        cargoKgs: receipt.cargoKgs,
        kyrgyzstanInternalTransportKgs: receipt.kyrgyzstanInternalTransportKgs,
      },
    });

    if (calc.totals.totalReceivedQuantity.lte(0)) {
      throw new BadRequestException('Укажите фактическое количество хотя бы для одного товара');
    }

    assertReceiptNotBeforePurchase(receipt.receiptDate, receipt.purchase.purchaseDate);

    const commentMap = new Map(
      (dto.discrepancyComments ?? []).map((row) => [row.productId, row.comment ?? null]),
    );

    const completed = await this.prisma.$transaction(async (tx) => {
      await tx.purchaseReceipt.update({
        where: { id },
        data: this.applyCalcToReceiptData(calc),
      });

      for (const row of receipt.items) {
        const calcItem = calc.items.find((i) => i.productId === row.productId)!;
        await tx.purchaseReceiptItem.update({
          where: { id: row.id },
          data: this.itemDataFromCalc(row.purchaseItemId, calcItem),
        });
      }

      await tx.purchaseReceiptDiscrepancy.deleteMany({ where: { receiptId: id } });
      if (calc.discrepancies.length > 0) {
        await tx.purchaseReceiptDiscrepancy.createMany({
          data: calc.discrepancies.map((d) => ({
            receiptId: id,
            productId: d.productId,
            orderedQuantity: d.orderedQuantity.toFixed(3),
            receivedQuantity: d.receivedQuantity.toFixed(3),
            difference: d.difference.toFixed(3),
            type: d.type as ReceiptDiscrepancyType,
            comment: commentMap.get(d.productId) ?? null,
          })),
        });
      }

      for (const calcItem of calc.items) {
        if (calcItem.receivedQuantity.lte(0)) continue;

        const existing = await tx.inventory.findUnique({
          where: { productId: calcItem.productId },
        });

        const inventoryUpdate = computeInventoryAfterReceipt({
          currentQuantity: existing?.quantity != null ? String(existing.quantity) : 0,
          currentTotalValueKgs: existing?.totalValueKgs != null ? String(existing.totalValueKgs) : 0,
          receivedQuantity: calcItem.receivedQuantity.toFixed(3),
          unitLandedCostKgs: calcItem.unitLandedCostKgs.toFixed(4),
        });

        if (existing) {
          await tx.inventory.update({
            where: { productId: calcItem.productId },
            data: {
              quantity: inventoryUpdate.newQuantity.toFixed(3),
              averageUnitCostKgs: inventoryUpdate.averageUnitCostKgs.toFixed(4),
              totalValueKgs: inventoryUpdate.newTotalValueKgs.toFixed(2),
            },
          });
        } else {
          await tx.inventory.create({
            data: {
              productId: calcItem.productId,
              quantity: inventoryUpdate.newQuantity.toFixed(3),
              averageUnitCostKgs: inventoryUpdate.averageUnitCostKgs.toFixed(4),
              totalValueKgs: inventoryUpdate.newTotalValueKgs.toFixed(2),
            },
          });
        }

        await tx.inventoryMovement.create({
          data: {
            type: InventoryMovementType.PURCHASE_RECEIPT,
            productId: calcItem.productId,
            quantity: calcItem.receivedQuantity.toFixed(3),
            previousQuantity: inventoryUpdate.previousQuantity.toFixed(3),
            newQuantity: inventoryUpdate.newQuantity.toFixed(3),
            unitCost: inventoryUpdate.unitCost.toFixed(4),
            totalCost: inventoryUpdate.totalCost.toFixed(2),
            referenceType: InventoryReferenceType.PURCHASE_RECEIPT,
            referenceId: id,
            userId: user.id,
            transactionDate: receipt.receiptDate,
          },
        });

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: RECEIPT_AUDIT_ACTIONS.RECEIPT_ITEM_RECEIVED,
            entityType: 'PurchaseReceiptItem',
            entityId: rowIdForProduct(receipt.items, calcItem.productId),
            oldValue: {
              inventoryQuantity: inventoryUpdate.previousQuantity.toFixed(3),
            },
            newValue: {
              productId: calcItem.productId,
              orderedQuantity: calcItem.orderedQuantity.toFixed(3),
              receivedQuantity: calcItem.receivedQuantity.toFixed(3),
              difference: calcItem.difference.toFixed(3),
              transportCost: calcItem.totalAllocatedTransportKgs.toFixed(2),
              landedCost: calcItem.totalLandedCostKgs.toFixed(2),
              inventoryQuantity: inventoryUpdate.newQuantity.toFixed(3),
            },
          },
        });
      }

      const purchaseStatus =
        calc.discrepancies.length > 0
          ? PurchaseStatus.RECEIVED_WITH_DISCREPANCY
          : PurchaseStatus.RECEIVED;

      await tx.purchase.update({
        where: { id: receipt.purchaseId },
        data: { status: purchaseStatus },
      });

      const done = await tx.purchaseReceipt.update({
        where: { id },
        data: { status: PurchaseReceiptStatus.COMPLETED },
        include: this.include(),
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: RECEIPT_AUDIT_ACTIONS.RECEIPT_COMPLETED,
          entityType: 'PurchaseReceipt',
          entityId: id,
          oldValue: { status: receipt.status },
          newValue: {
            status: PurchaseReceiptStatus.COMPLETED,
            purchaseId: receipt.purchaseId,
            purchaseNumber: receipt.purchase.number,
            receiptNumber: receipt.number,
            confirmation: {
              totalOrderedQuantity: calc.totals.totalOrderedQuantity.toFixed(3),
              totalReceivedQuantity: calc.totals.totalReceivedQuantity.toFixed(3),
              totalShortage: calc.totals.totalShortage.toFixed(3),
              totalExcess: calc.totals.totalExcess.toFixed(3),
              totalTransportKgs: calc.totals.totalTransportKgs.toFixed(2),
              totalLandedCostKgs: calc.totals.totalLandedCostKgs.toFixed(2),
            },
            purchaseStatus,
          },
        },
      });

      return done;
    });

    return this.serializeReceipt(completed as unknown as Record<string, unknown>);
  }

  async cancel(user: User, id: string) {
    const receipt = await this.prisma.purchaseReceipt.findUnique({ where: { id } });
    if (!receipt) throw new NotFoundException('Приход не найден');
    if (receipt.status === PurchaseReceiptStatus.COMPLETED) {
      throw new BadRequestException('Завершённый приход нельзя отменить');
    }
    if (receipt.status === PurchaseReceiptStatus.CANCELLED) {
      return this.get(id);
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseReceipt.update({
        where: { id },
        data: { status: PurchaseReceiptStatus.CANCELLED },
        include: this.include(),
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: RECEIPT_AUDIT_ACTIONS.RECEIPT_CANCELLED,
          entityType: 'PurchaseReceipt',
          entityId: id,
          oldValue: { status: receipt.status },
          newValue: { status: PurchaseReceiptStatus.CANCELLED },
        },
      });

      return updated;
    });

    return this.serializeReceipt(saved as unknown as Record<string, unknown>);
  }
}

function rowIdForProduct(
  items: Array<{ id: string; productId: string }>,
  productId: string,
): string {
  return items.find((item) => item.productId === productId)?.id ?? productId;
}
