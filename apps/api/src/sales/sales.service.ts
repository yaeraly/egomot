import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { User } from '@prisma/client';
import {
  ClientDebtTransactionType,
  FinancialTransactionType,
  InventoryMovementType,
  InventoryReferenceType,
  Prisma,
  SalePaymentStatus,
  SaleReturnStatus,
  SaleStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { publicDecimal } from '../common/decimal.util';
import { dec, roundMoney, roundQty } from '../purchases/purchase-calc';
import { roundMarkup } from '../pricing/pricing-calc';
import { PricingService } from '../pricing/pricing.service';
import { ClientCategoryService } from '../pricing/client-category.service';
import { FinanceBalanceService } from '../finance/finance-balance.service';
import { ClientDebtService } from './client-debt.service';
import {
  SaleReceiptService,
  WhatsAppService,
} from './sale-receipt.service';
import {
  computeInventoryAfterSale,
  resolvePaymentStatus,
  SaleValidationError,
  validatePaymentEntries,
} from './sale-calc';
import { SALE_AUDIT_ACTIONS } from './sale-audit';
import { USER_ROLE_LABELS } from '../common/sales-access';
import {
  ConfirmSaleDto,
  CreateSaleReturnDto,
  UpdateSaleDateDto,
  UpdateSaleItemPriceDto,
  PayDebtDto,
  PreviewSaleDto,
  SalePaymentEntryDto,
} from './dto/sale.dto';

const CLIENT_TYPE_LABELS = {
  RETAIL: 'Розничный',
  MASTER: 'Мастер',
  WHOLESALE: 'Оптовый',
} as const;

const CATEGORY_LABELS = {
  STANDARD: 'Standard',
  SILVER: 'Silver',
  GOLD: 'Gold',
  VIP: 'VIP',
} as const;

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly clientCategory: ClientCategoryService,
    private readonly finance: FinanceBalanceService,
    private readonly clientDebt: ClientDebtService,
    private readonly receiptService: SaleReceiptService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  private saleInclude = {
    items: { include: { product: { include: { category: true } } } },
    client: true,
    soldBy: { select: { id: true, name: true, email: true, role: true } },
    createdBy: { select: { id: true, name: true, role: true } },
    confirmedBy: { select: { id: true, name: true, role: true } },
    payments: {
      include: {
        paymentMethod: true,
        paymentAccount: true,
        receivedBy: { select: { id: true, name: true } },
      },
    },
    receipt: true,
  } as const;

  private handleValidation(error: unknown): never {
    if (error instanceof SaleValidationError) {
      throw new BadRequestException(error.messages.join('; '));
    }
    throw error;
  }

  async list(search?: string, clientId?: string) {
    const where: Prisma.SaleWhereInput = {};
    if (clientId) where.clientId = clientId;
    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { number: { contains: q, mode: 'insensitive' } },
        { client: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }
    const sales = await this.prisma.sale.findMany({
      where,
      include: {
        client: true,
        soldBy: { select: { id: true, name: true } },
        items: true,
        payments: true,
      },
      orderBy: [{ confirmedAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });
    return sales.map((sale) => this.serializeSale(sale));
  }

  async preview(dto: PreviewSaleDto) {
    const client = await this.prisma.client.findUnique({
      where: { id: dto.clientId },
    });
    if (!client) throw new NotFoundException('Клиент не найден');

    const pricingSnapshot = await this.clientCategory.getClientPricingSnapshot(
      client.id,
      client.clientType,
    );
    const debtSummary = await this.clientDebt.getDebtSummary(client.id);

    const lines = [];
    let total = dec(0);
    for (const row of dto.items) {
      const quantity = roundQty(row.quantity);
      const price = await this.pricing.calculatePrice(row.productId, dto.clientId);
      const lineTotal = roundMoney(dec(price.finalPriceKgs).times(quantity));
      total = total.plus(lineTotal);
      const stock = await this.prisma.inventory.findUnique({
        where: { productId: row.productId },
      });
      lines.push({
        productId: row.productId,
        quantity: publicDecimal(quantity),
        unitPriceKgs: price.finalPriceKgs,
        lineTotalKgs: publicDecimal(lineTotal),
        pricing: price,
        stockQuantity: stock ? publicDecimal(stock.quantity) : '0',
      });
    }

    return {
      client,
      pricing: {
        ...pricingSnapshot,
        clientTypeLabel: CLIENT_TYPE_LABELS[client.clientType],
        clientCategoryLabel: CATEGORY_LABELS[pricingSnapshot.clientCategory],
      },
      debt: {
        previousDebtKgs: debtSummary.currentDebtKgs,
        openSales: debtSummary.openSales,
      },
      currentDebtKgs: debtSummary.currentDebtKgs,
      items: lines,
      totalAmountKgs: publicDecimal(roundMoney(total)),
    };
  }

  async confirm(user: User, dto: ConfirmSaleDto) {
    if (dto.idempotencyKey?.trim()) {
      const existing = await this.prisma.sale.findUnique({
        where: { idempotencyKey: dto.idempotencyKey.trim() },
        include: this.saleInclude,
      });
      if (existing && existing.status !== SaleStatus.DRAFT) {
        return this.serializeSale(existing);
      }
    }

    const client = await this.prisma.client.findUnique({
      where: { id: dto.clientId },
    });
    if (!client) throw new NotFoundException('Клиент не найден');
    if (!dto.items.length) {
      throw new BadRequestException('Добавьте товары в продажу');
    }

    const saleDateTime = dto.saleDate ? new Date(dto.saleDate) : new Date();
    if (Number.isNaN(saleDateTime.getTime())) {
      throw new BadRequestException('Некорректная дата продажи');
    }

    const paymentEntries = dto.payments.filter((p) => dec(p.amountKgs).gt(0));

    try {
      const pricedItems: Array<{
        productId: string;
        quantity: Prisma.Decimal;
        price: Awaited<ReturnType<PricingService['calculatePrice']>>;
        lineTotal: Prisma.Decimal;
      }> = [];

      let totalAmount = dec(0);
      for (const row of dto.items) {
        const quantity = roundQty(row.quantity);
        if (quantity.lte(0)) {
          throw new SaleValidationError([
            'Количество должно быть больше нуля',
          ]);
        }
        const price = await this.pricing.calculatePrice(
          row.productId,
          dto.clientId,
        );
        const lineTotal = roundMoney(dec(price.finalPriceKgs).times(quantity));
        totalAmount = totalAmount.plus(lineTotal);
        pricedItems.push({ productId: row.productId, quantity, price, lineTotal });
      }
      totalAmount = roundMoney(totalAmount);

      const { paidAmountKgs, debtAmountKgs } = validatePaymentEntries(
        totalAmount,
        paymentEntries,
      );
      const paymentStatus = resolvePaymentStatus(totalAmount, paidAmountKgs);

      const pricingSnapshot = await this.clientCategory.getClientPricingSnapshot(
        client.id,
        client.clientType,
      );
      const previousDebtKgs = await this.clientDebt.getCurrentDebtKgs(client.id);

      return await this.prisma.$transaction(async (tx) => {
        const number = await this.nextSaleNumber(tx);
        const confirmedAt = saleDateTime;

        const sale = await tx.sale.create({
          data: {
            number,
            idempotencyKey: dto.idempotencyKey?.trim() || null,
            clientId: dto.clientId,
            soldByUserId: user.id,
            createdByUserId: user.id,
            confirmedByUserId: user.id,
            clientTypeAtSale: client.clientType,
            clientCategoryAtSale: pricingSnapshot.clientCategory,
            status: SaleStatus.CONFIRMED,
            paymentStatus:
              paymentStatus === 'PAID'
                ? SalePaymentStatus.PAID
                : paymentStatus === 'PARTIAL'
                  ? SalePaymentStatus.PARTIAL
                  : SalePaymentStatus.UNPAID,
            saleDate: saleDateTime,
            totalAmountKgs: totalAmount,
            paidAmountKgs,
            debtAmountKgs,
            fullyPaidAt: paymentStatus === 'PAID' ? saleDateTime : null,
            confirmedAt,
            items: {
              create: pricedItems.map((row) => ({
                productId: row.productId,
                quantity: row.quantity,
                unitCostKgs: dec(row.price.costPriceKgs),
                unitPriceKgs: dec(row.price.finalPriceKgs),
                lineTotalKgs: row.lineTotal,
                baseMarkupPercent: dec(row.price.baseMarkupPercent),
                clientMarkupPercent: dec(row.price.clientMarkupPercent),
                finalMarkupPercent: dec(row.price.finalMarkupPercent),
                clientTypeAtSale: client.clientType,
                clientCategoryAtSale: pricingSnapshot.clientCategory,
              })),
            },
          },
        });

        for (const row of pricedItems) {
          const existing = await tx.inventory.findUnique({
            where: { productId: row.productId },
          });
          const product = await tx.product.findUnique({
            where: { id: row.productId },
          });
          const productName = product?.name ?? row.productId;
          if (!existing || existing.quantity.lt(row.quantity)) {
            const available = existing ? publicDecimal(existing.quantity) : '0';
            throw new SaleValidationError([
              `Продажа невозможна. Недостаточно товара: ${productName}. Доступно: ${available}, Запрошено: ${publicDecimal(row.quantity)}`,
            ]);
          }

          const inventoryUpdate = computeInventoryAfterSale({
            currentQuantity: existing.quantity,
            currentTotalValueKgs: existing.totalValueKgs,
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
              userId: user.id,
              transactionDate: saleDateTime,
            },
          });
        }

        for (const entry of paymentEntries) {
          await this.recordPaymentInTransaction(
            tx,
            user,
            sale,
            client.id,
            entry,
            saleDateTime,
          );
        }

        if (debtAmountKgs.gt(0)) {
          await this.clientDebt.recordDebtChange(tx, {
            clientId: client.id,
            saleId: sale.id,
            type: ClientDebtTransactionType.SALE_DEBT,
            amountKgs: debtAmountKgs,
            recordedByUserId: user.id,
            note: `Долг по продаже ${sale.number}`,
          });
        }

        const clientTotalDebt = await this.clientDebt.getCurrentDebtKgs(client.id);

        const fullSale = await tx.sale.findUniqueOrThrow({
          where: { id: sale.id },
          include: this.saleInclude,
        });

        const receiptNumber = await this.receiptService.nextReceiptNumber(tx);
        const payload = this.receiptService.buildPayload({
          sale: fullSale,
          clientTypeLabel: CLIENT_TYPE_LABELS[client.clientType],
          clientCategoryLabel: CATEGORY_LABELS[pricingSnapshot.clientCategory],
          clientTotalDebtKgs: clientTotalDebt,
          previousDebtKgs,
          newDebtKgs: debtAmountKgs,
          operatorRoleLabel: USER_ROLE_LABELS[user.role],
          receiptNumber,
        });

        await tx.saleReceipt.create({
          data: {
            saleId: sale.id,
            number: receiptNumber,
            payload: payload as unknown as Prisma.InputJsonValue,
          },
        });

        await tx.auditLog.create({
          data: {
            userId: user.id,
            action: SALE_AUDIT_ACTIONS.SALE_CONFIRMED,
            entityType: 'Sale',
            entityId: sale.id,
            newValue: {
              number: sale.number,
              totalAmountKgs: publicDecimal(totalAmount),
              paidAmountKgs: publicDecimal(paidAmountKgs),
              debtAmountKgs: publicDecimal(debtAmountKgs),
            },
          },
        });

        const result = await tx.sale.findUniqueOrThrow({
          where: { id: sale.id },
          include: this.saleInclude,
        });
        return this.serializeSale(result, payload);
      });
    } catch (error) {
      this.handleValidation(error);
    }
  }

  private async recordPaymentInTransaction(
    tx: Prisma.TransactionClient,
    user: User,
    sale: { id: string; number: string },
    clientId: string,
    entry: SalePaymentEntryDto,
    paidAt: Date,
  ) {
    const amount = roundMoney(entry.amountKgs);
    if (amount.lte(0)) return;

    const account = await this.finance.resolvePaymentAccount(
      user.id,
      entry.paymentAccountId,
    );

    const payment = await tx.payment.create({
      data: {
        saleId: sale.id,
        clientId,
        paymentMethodId: account.paymentMethodId,
        paymentAccountId: account.id,
        receivedByUserId: user.id,
        amountKgs: amount,
        paidAt,
      },
    });

    await tx.financialTransaction.create({
      data: {
        type: FinancialTransactionType.SALE_PAYMENT,
        paymentAccountId: account.id,
        saleId: sale.id,
        paymentId: payment.id,
        amountKgs: amount,
        recordedByUserId: user.id,
        transactionAt: paidAt,
        note: `Оплата продажи ${sale.number}`,
      },
    });
  }

  async payDebt(user: User, saleId: string, dto: PayDebtDto) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { client: true },
    });
    if (!sale) throw new NotFoundException('Продажа не найдена');
    if (sale.debtAmountKgs.lte(0)) {
      throw new BadRequestException('По этой продаже нет долга');
    }

    const amount = roundMoney(dto.amountKgs);
    if (amount.lte(0)) {
      throw new BadRequestException('Сумма оплаты должна быть больше нуля');
    }
    if (amount.gt(sale.debtAmountKgs)) {
      throw new BadRequestException('Сумма превышает долг по продаже');
    }

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();

    return this.prisma.$transaction(async (tx) => {
      const entry: SalePaymentEntryDto = {
        paymentAccountId: dto.paymentAccountId,
        amountKgs: publicDecimal(amount),
      };
      await this.recordPaymentInTransaction(
        tx,
        user,
        sale,
        sale.clientId,
        entry,
        paidAt,
      );

      const newPaid = roundMoney(sale.paidAmountKgs.plus(amount));
      const newDebt = roundMoney(sale.debtAmountKgs.minus(amount));
      const paymentStatus =
        newDebt.lte(0) ? SalePaymentStatus.PAID : SalePaymentStatus.PARTIAL;

      const updated = await tx.sale.update({
        where: { id: saleId },
        data: {
          paidAmountKgs: newPaid,
          debtAmountKgs: newDebt,
          paymentStatus,
          fullyPaidAt: newDebt.lte(0) ? paidAt : sale.fullyPaidAt,
        },
        include: this.saleInclude,
      });

      const payment = await tx.payment.findFirst({
        where: { saleId, paidAt },
        orderBy: { createdAt: 'desc' },
      });

      await this.clientDebt.recordDebtChange(tx, {
        clientId: sale.clientId,
        saleId: sale.id,
        type: ClientDebtTransactionType.DEBT_PAYMENT,
        amountKgs: amount,
        recordedByUserId: user.id,
        paymentId: payment?.id,
        note: `Погашение долга по продаже ${sale.number}`,
      });

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: SALE_AUDIT_ACTIONS.DEBT_PAYMENT,
          entityType: 'Sale',
          entityId: sale.id,
          newValue: {
            paidAmountKgs: publicDecimal(newPaid),
            debtAmountKgs: publicDecimal(newDebt),
          },
        },
      });

      return this.serializeSale(updated);
    });
  }

  async getReceipt(id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        ...this.saleInclude,
        receipt: true,
        client: true,
      },
    });
    if (!sale) throw new NotFoundException('Продажа не найдена');
    if (!sale.receipt) throw new NotFoundException('Чек не найден');

    const payload = sale.receipt.payload as unknown as import('./sale-receipt.service').SaleReceiptPayload;
    const text = this.receiptService.formatReceiptText(payload);
    const whatsappUrl = this.whatsapp.buildShareUrl(sale.client.phone, text);

    return {
      receipt: sale.receipt,
      payload,
      text,
      whatsapp: {
        phone: sale.client.phone,
        url: whatsappUrl,
        available: Boolean(whatsappUrl),
      },
    };
  }

  async get(id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: this.saleInclude,
    });
    if (!sale) throw new NotFoundException('Продажа не найдена');
    return this.serializeSale(sale);
  }

  async updateSaleDate(user: User, saleId: string, dto: UpdateSaleDateDto) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { client: true, receipt: true },
    });
    if (!sale) throw new NotFoundException('Продажа не найдена');
    if (sale.status === SaleStatus.CANCELLED) {
      throw new BadRequestException('Нельзя изменить дату отменённой продажи');
    }

    const saleDateTime = new Date(dto.saleDate);
    if (Number.isNaN(saleDateTime.getTime())) {
      throw new BadRequestException('Некорректная дата продажи');
    }

    return this.prisma.$transaction(async (tx) => {
      const fullyPaidAt =
        sale.paymentStatus === SalePaymentStatus.PAID ? saleDateTime : sale.fullyPaidAt;

      const updated = await tx.sale.update({
        where: { id: saleId },
        data: {
          saleDate: saleDateTime,
          confirmedAt: saleDateTime,
          fullyPaidAt,
        },
        include: this.saleInclude,
      });

      await tx.inventoryMovement.updateMany({
        where: {
          referenceType: InventoryReferenceType.SALE,
          referenceId: saleId,
        },
        data: { transactionDate: saleDateTime },
      });

      if (sale.receipt) {
        await this.refreshReceiptSnapshot(tx, updated);
      }

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: SALE_AUDIT_ACTIONS.SALE_DATE_UPDATED,
          entityType: 'Sale',
          entityId: saleId,
          oldValue: {
            saleDate: sale.saleDate.toISOString(),
            confirmedAt: sale.confirmedAt?.toISOString() ?? null,
          },
          newValue: {
            saleDate: saleDateTime.toISOString(),
            confirmedAt: saleDateTime.toISOString(),
          },
        },
      });

      return this.serializeSale(updated);
    });
  }

  async updateSaleItemPrice(
    user: User,
    saleId: string,
    itemId: string,
    dto: UpdateSaleItemPriceDto,
  ) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true, client: true, receipt: true },
    });
    if (!sale) throw new NotFoundException('Продажа не найдена');
    if (sale.status === SaleStatus.CANCELLED) {
      throw new BadRequestException('Нельзя изменить цену в отменённой продаже');
    }

    const item = sale.items.find((row) => row.id === itemId);
    if (!item) throw new NotFoundException('Позиция продажи не найдена');

    const unitPrice = roundMoney(dto.unitPriceKgs);
    if (unitPrice.lte(0)) {
      throw new BadRequestException('Цена продажи должна быть больше нуля');
    }

    const unitCost = dec(item.unitCostKgs);
    const finalMarkupPercent = unitCost.gt(0)
      ? roundMarkup(unitPrice.div(unitCost).minus(1).times(100))
      : roundMarkup(item.finalMarkupPercent);

    const lineTotal = roundMoney(unitPrice.times(item.quantity));
    let newTotal = dec(0);
    for (const row of sale.items) {
      newTotal = newTotal.plus(row.id === itemId ? lineTotal : row.lineTotalKgs);
    }
    newTotal = roundMoney(newTotal);

    const paid = dec(sale.paidAmountKgs);
    if (newTotal.lt(paid)) {
      throw new BadRequestException(
        'Итого продажи не может быть меньше уже оплаченной суммы',
      );
    }

    const debtAmountKgs = roundMoney(newTotal.minus(paid));
    const paymentStatus = resolvePaymentStatus(newTotal, paid);

    return this.prisma.$transaction(async (tx) => {
      await tx.saleItem.update({
        where: { id: itemId },
        data: {
          unitPriceKgs: unitPrice,
          lineTotalKgs: lineTotal,
          finalMarkupPercent,
        },
      });

      const updated = await tx.sale.update({
        where: { id: saleId },
        data: {
          totalAmountKgs: newTotal,
          debtAmountKgs,
          paymentStatus:
            paymentStatus === 'PAID'
              ? SalePaymentStatus.PAID
              : paymentStatus === 'PARTIAL'
                ? SalePaymentStatus.PARTIAL
                : SalePaymentStatus.UNPAID,
          fullyPaidAt:
            paymentStatus === 'PAID'
              ? sale.fullyPaidAt ?? sale.confirmedAt ?? sale.saleDate
              : null,
        },
        include: this.saleInclude,
      });

      if (sale.receipt) {
        await this.refreshReceiptSnapshot(tx, updated);
      }

      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: SALE_AUDIT_ACTIONS.SALE_ITEM_PRICE_UPDATED,
          entityType: 'SaleItem',
          entityId: itemId,
          oldValue: {
            saleId,
            unitPriceKgs: publicDecimal(item.unitPriceKgs),
            lineTotalKgs: publicDecimal(item.lineTotalKgs),
            totalAmountKgs: publicDecimal(sale.totalAmountKgs),
          },
          newValue: {
            saleId,
            unitPriceKgs: publicDecimal(unitPrice),
            lineTotalKgs: publicDecimal(lineTotal),
            totalAmountKgs: publicDecimal(newTotal),
          },
        },
      });

      return this.serializeSale(updated);
    });
  }

  private async refreshReceiptSnapshot(
    tx: Prisma.TransactionClient,
    sale: { id: string; clientTypeAtSale?: import('@prisma/client').ClientType | null; clientCategoryAtSale?: import('@prisma/client').ClientPricingCategory | null; receipt: { number: string } | null },
  ) {
    if (!sale.receipt) return;

    const fullSale = await tx.sale.findUniqueOrThrow({
      where: { id: sale.id },
      include: { ...this.saleInclude, receipt: true },
    });

    const client = fullSale.client;
    const clientType = sale.clientTypeAtSale ?? client.clientType;
    const pricingSnapshot = await this.clientCategory.getClientPricingSnapshot(
      client.id,
      clientType,
    );
    const clientTotalDebt = await this.clientDebt.getCurrentDebtKgs(client.id);

    const payload = this.receiptService.buildPayload({
      sale: fullSale,
      clientTypeLabel: CLIENT_TYPE_LABELS[clientType],
      clientCategoryLabel:
        CATEGORY_LABELS[sale.clientCategoryAtSale ?? pricingSnapshot.clientCategory],
      clientTotalDebtKgs: clientTotalDebt,
      previousDebtKgs: '0',
      newDebtKgs: fullSale.debtAmountKgs,
      operatorRoleLabel:
        fullSale.soldBy?.role && fullSale.soldBy.role in USER_ROLE_LABELS
          ? USER_ROLE_LABELS[fullSale.soldBy.role as keyof typeof USER_ROLE_LABELS]
          : fullSale.soldBy?.role ?? '—',
      receiptNumber: sale.receipt.number,
    });

    await tx.saleReceipt.update({
      where: { saleId: sale.id },
      data: { payload: payload as unknown as Prisma.InputJsonValue },
    });
  }

  async createReturn(saleId: string, dto: CreateSaleReturnDto) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true },
    });
    if (!sale) throw new NotFoundException('Продажа не найдена');
    if (
      sale.paymentStatus !== SalePaymentStatus.PAID ||
      (sale.status !== SaleStatus.COMPLETED && sale.status !== SaleStatus.CONFIRMED)
    ) {
      throw new BadRequestException(
        'Возврат возможен только для полностью оплаченной продажи',
      );
    }

    const returnDate = new Date(dto.returnDate);
    if (Number.isNaN(returnDate.getTime())) {
      throw new BadRequestException('Некорректная дата возврата');
    }

    return this.prisma.$transaction(async (tx) => {
      const number = await this.nextReturnNumber(tx);
      let totalRefund = dec(0);
      const itemCreates: Prisma.SaleReturnItemCreateWithoutSaleReturnInput[] =
        [];

      for (const row of dto.items) {
        const quantity = roundQty(row.quantity);
        const refund = roundMoney(row.refundAmountKgs);
        if (quantity.lte(0) || refund.lte(0)) {
          throw new BadRequestException('Некорректные данные возврата');
        }
        const saleItem = sale.items.find(
          (item) => item.productId === row.productId,
        );
        if (!saleItem) {
          throw new BadRequestException('Товар отсутствует в продаже');
        }
        totalRefund = totalRefund.plus(refund);
        itemCreates.push({
          product: { connect: { id: row.productId } },
          quantity,
          refundAmountKgs: refund,
        });
      }

      const saleReturn = await tx.saleReturn.create({
        data: {
          number,
          saleId,
          clientId: sale.clientId,
          status: SaleReturnStatus.COMPLETED,
          returnDate,
          totalRefundKgs: roundMoney(totalRefund),
          completedAt: new Date(),
          items: { create: itemCreates },
        },
        include: { items: { include: { product: true } } },
      });

      return this.serializeReturn(saleReturn);
    });
  }

  private async nextSaleNumber(tx: Prisma.TransactionClient): Promise<string> {
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

  private async nextReturnNumber(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const rows = await tx.saleReturn.findMany({
      where: { number: { startsWith: 'SR-' } },
      select: { number: true },
    });
    let max = 0;
    for (const row of rows) {
      const match = row.number.match(/^SR-(\d+)$/);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `SR-${String(max + 1).padStart(5, '0')}`;
  }

  private serializeSale(
    sale: {
      totalAmountKgs: Prisma.Decimal;
      paidAmountKgs: Prisma.Decimal;
      debtAmountKgs?: Prisma.Decimal;
      soldBy?: { id: string; name: string; role?: string } | null;
      createdBy?: { id: string; name: string; role?: string } | null;
      confirmedBy?: { id: string; name: string; role?: string } | null;
      items: Array<{
        quantity: Prisma.Decimal;
        unitCostKgs: Prisma.Decimal;
        unitPriceKgs: Prisma.Decimal;
        lineTotalKgs: Prisma.Decimal;
        baseMarkupPercent: Prisma.Decimal;
        clientMarkupPercent: Prisma.Decimal;
        finalMarkupPercent: Prisma.Decimal;
        [key: string]: unknown;
      }>;
      payments?: Array<{
        amountKgs: Prisma.Decimal;
        [key: string]: unknown;
      }>;
      [key: string]: unknown;
    },
    receiptPayload?: import('./sale-receipt.service').SaleReceiptPayload,
  ) {
    const operator = sale.confirmedBy ?? sale.soldBy ?? sale.createdBy;
    return {
      ...sale,
      saleDate:
        sale.saleDate instanceof Date
          ? sale.saleDate.toISOString()
          : (sale.saleDate as string),
      confirmedAt:
        sale.confirmedAt instanceof Date
          ? sale.confirmedAt.toISOString()
          : (sale.confirmedAt as string | null),
      fullyPaidAt:
        sale.fullyPaidAt instanceof Date
          ? sale.fullyPaidAt.toISOString()
          : (sale.fullyPaidAt as string | null),
      operator: operator
        ? {
            id: operator.id,
            name: operator.name,
            role: operator.role,
            roleLabel:
              operator.role && operator.role in USER_ROLE_LABELS
                ? USER_ROLE_LABELS[operator.role as keyof typeof USER_ROLE_LABELS]
                : operator.role ?? null,
          }
        : null,
      totalAmountKgs: publicDecimal(sale.totalAmountKgs),
      paidAmountKgs: publicDecimal(sale.paidAmountKgs),
      debtAmountKgs: publicDecimal(sale.debtAmountKgs ?? 0),
      items: sale.items.map((item) => ({
        ...item,
        quantity: publicDecimal(item.quantity),
        unitCostKgs: publicDecimal(item.unitCostKgs),
        unitPriceKgs: publicDecimal(item.unitPriceKgs),
        lineTotalKgs: publicDecimal(item.lineTotalKgs),
        baseMarkupPercent: publicDecimal(item.baseMarkupPercent),
        clientMarkupPercent: publicDecimal(item.clientMarkupPercent),
        finalMarkupPercent: publicDecimal(item.finalMarkupPercent),
      })),
      payments: (sale.payments ?? []).map((p) => ({
        ...p,
        amountKgs: publicDecimal(p.amountKgs),
      })),
      receiptPayload,
    };
  }

  private serializeReturn(saleReturn: {
    totalRefundKgs: Prisma.Decimal;
    items: Array<{
      quantity: Prisma.Decimal;
      refundAmountKgs: Prisma.Decimal;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  }) {
    return {
      ...saleReturn,
      totalRefundKgs: publicDecimal(saleReturn.totalRefundKgs),
      items: saleReturn.items.map((item) => ({
        ...item,
        quantity: publicDecimal(item.quantity),
        refundAmountKgs: publicDecimal(item.refundAmountKgs),
      })),
    };
  }
}
