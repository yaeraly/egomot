import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SalePaymentStatus,
  SaleReturnStatus,
  SaleStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { publicDecimal } from '../common/decimal.util';
import { dec, roundMoney, roundQty } from '../purchases/purchase-calc';
import { PricingService } from '../pricing/pricing.service';
import {
  AddPaymentDto,
  CreateSaleDto,
  CreateSaleReturnDto,
} from './dto/sale.dto';

@Injectable()
export class SalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

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

  async create(dto: CreateSaleDto) {
    const client = await this.prisma.client.findUnique({
      where: { id: dto.clientId },
    });
    if (!client) throw new NotFoundException('Клиент не найден');

    const saleDate = new Date(dto.saleDate);
    if (Number.isNaN(saleDate.getTime())) {
      throw new BadRequestException('Некорректная дата продажи');
    }

    return this.prisma.$transaction(async (tx) => {
      const number = await this.nextSaleNumber(tx);
      let totalAmount = dec(0);
      const itemCreates: Prisma.SaleItemCreateWithoutSaleInput[] = [];

      for (const row of dto.items) {
        const quantity = roundQty(row.quantity);
        if (quantity.lte(0)) {
          throw new BadRequestException('Количество должно быть больше нуля');
        }

        const price = await this.pricing.calculatePrice(
          row.productId,
          dto.clientId,
        );
        const lineTotal = roundMoney(dec(price.finalPriceKgs).times(quantity));
        totalAmount = totalAmount.plus(lineTotal);

        itemCreates.push({
          product: { connect: { id: row.productId } },
          quantity,
          unitCostKgs: dec(price.costPriceKgs),
          unitPriceKgs: dec(price.finalPriceKgs),
          lineTotalKgs: lineTotal,
          baseMarkupPercent: dec(price.baseMarkupPercent),
          clientMarkupPercent: dec(price.clientMarkupPercent),
          finalMarkupPercent: dec(price.finalMarkupPercent),
        });
      }

      const sale = await tx.sale.create({
        data: {
          number,
          clientId: dto.clientId,
          status: SaleStatus.CONFIRMED,
          paymentStatus: SalePaymentStatus.UNPAID,
          saleDate,
          totalAmountKgs: roundMoney(totalAmount),
          paidAmountKgs: roundMoney(0),
          items: { create: itemCreates },
        },
        include: { items: { include: { product: true } }, client: true },
      });

      return this.serializeSale(sale);
    });
  }

  async addPayment(saleId: string, dto: AddPaymentDto) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { payments: true },
    });
    if (!sale) throw new NotFoundException('Продажа не найдена');
    if (
      sale.status === SaleStatus.CANCELLED ||
      sale.status === SaleStatus.DRAFT
    ) {
      throw new BadRequestException('Нельзя принять оплату для этой продажи');
    }

    const amount = roundMoney(dto.amountKgs);
    if (amount.lte(0)) {
      throw new BadRequestException('Сумма оплаты должна быть больше нуля');
    }

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    if (Number.isNaN(paidAt.getTime())) {
      throw new BadRequestException('Некорректная дата оплаты');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          saleId,
          clientId: sale.clientId,
          amountKgs: amount,
          paidAt,
        },
      });

      const newPaid = roundMoney(dec(sale.paidAmountKgs).plus(amount));
      const total = roundMoney(sale.totalAmountKgs);

      let paymentStatus: SalePaymentStatus = SalePaymentStatus.PARTIAL;
      let fullyPaidAt: Date | null = sale.fullyPaidAt;
      let status = sale.status;

      if (newPaid.gte(total)) {
        if (newPaid.gt(total)) {
          throw new BadRequestException('Сумма оплат превышает сумму продажи');
        }
        paymentStatus = SalePaymentStatus.PAID;
        fullyPaidAt = paidAt;
        status = SaleStatus.COMPLETED;
      } else if (newPaid.eq(0)) {
        paymentStatus = SalePaymentStatus.UNPAID;
        fullyPaidAt = null;
      }

      const updated = await tx.sale.update({
        where: { id: saleId },
        data: {
          paidAmountKgs: newPaid,
          paymentStatus,
          fullyPaidAt,
          status,
        },
        include: {
          items: { include: { product: true } },
          client: true,
          payments: true,
        },
      });

      return this.serializeSale(updated);
    });
  }

  async cancel(saleId: string) {
    const sale = await this.prisma.sale.findUnique({ where: { id: saleId } });
    if (!sale) throw new NotFoundException('Продажа не найдена');
    if (sale.paymentStatus === SalePaymentStatus.PAID) {
      throw new BadRequestException(
        'Нельзя отменить полностью оплаченную продажу',
      );
    }

    const updated = await this.prisma.sale.update({
      where: { id: saleId },
      data: {
        status: SaleStatus.CANCELLED,
        paymentStatus: SalePaymentStatus.UNPAID,
        fullyPaidAt: null,
      },
      include: { items: { include: { product: true } }, client: true },
    });
    return this.serializeSale(updated);
  }

  async createReturn(saleId: string, dto: CreateSaleReturnDto) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true },
    });
    if (!sale) throw new NotFoundException('Продажа не найдена');
    if (
      sale.paymentStatus !== SalePaymentStatus.PAID ||
      sale.status !== SaleStatus.COMPLETED
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

  async get(id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        items: { include: { product: true } },
        client: true,
        payments: true,
      },
    });
    if (!sale) throw new NotFoundException('Продажа не найдена');
    return this.serializeSale(sale);
  }

  private serializeSale(sale: {
    totalAmountKgs: Prisma.Decimal;
    paidAmountKgs: Prisma.Decimal;
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
    [key: string]: unknown;
  }) {
    return {
      ...sale,
      totalAmountKgs: publicDecimal(sale.totalAmountKgs),
      paidAmountKgs: publicDecimal(sale.paidAmountKgs),
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
