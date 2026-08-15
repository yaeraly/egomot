import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { publicDecimal } from '../common/decimal.util';
import { dec } from '../purchases/purchase-calc';
import { PrismaService } from '../prisma/prisma.service';

export interface ReceiptLine {
  productName: string;
  productCode: string;
  quantity: string;
  unitPriceKgs: string;
  lineTotalKgs: string;
}

export interface ReceiptPaymentLine {
  methodName: string;
  amountKgs: string;
}

export interface SaleReceiptPayload {
  businessName: string;
  receiptNumber: string;
  saleNumber: string;
  confirmedAt: string;
  employeeName: string;
  clientName: string;
  clientTypeLabel: string;
  clientCategoryLabel: string;
  items: ReceiptLine[];
  totalAmountKgs: string;
  payments: ReceiptPaymentLine[];
  paidAmountKgs: string;
  debtAmountKgs: string;
  clientTotalDebtKgs: string;
}

@Injectable()
export class SaleReceiptService {
  constructor(private readonly prisma: PrismaService) {}

  buildPayload(input: {
    sale: {
      number: string;
      totalAmountKgs: Prisma.Decimal;
      paidAmountKgs: Prisma.Decimal;
      debtAmountKgs: Prisma.Decimal;
      confirmedAt: Date | null;
      soldBy: { name: string } | null;
      client: { name: string };
      items: Array<{
        quantity: Prisma.Decimal;
        unitPriceKgs: Prisma.Decimal;
        lineTotalKgs: Prisma.Decimal;
        product: { name: string; code: string };
      }>;
      payments: Array<{
        amountKgs: Prisma.Decimal;
        paymentMethod: { name: string };
      }>;
    };
    clientTypeLabel: string;
    clientCategoryLabel: string;
    clientTotalDebtKgs: Prisma.Decimal | string;
    receiptNumber: string;
  }): SaleReceiptPayload {
    return {
      businessName: 'EMOTORS',
      receiptNumber: input.receiptNumber,
      saleNumber: input.sale.number,
      confirmedAt: input.sale.confirmedAt?.toISOString() ?? new Date().toISOString(),
      employeeName: input.sale.soldBy?.name ?? '—',
      clientName: input.sale.client.name,
      clientTypeLabel: input.clientTypeLabel,
      clientCategoryLabel: input.clientCategoryLabel,
      items: input.sale.items.map((item) => ({
        productName: item.product.name,
        productCode: item.product.code,
        quantity: publicDecimal(item.quantity),
        unitPriceKgs: publicDecimal(item.unitPriceKgs),
        lineTotalKgs: publicDecimal(item.lineTotalKgs),
      })),
      totalAmountKgs: publicDecimal(input.sale.totalAmountKgs),
      payments: input.sale.payments.map((p) => ({
        methodName: p.paymentMethod.name,
        amountKgs: publicDecimal(p.amountKgs),
      })),
      paidAmountKgs: publicDecimal(input.sale.paidAmountKgs),
      debtAmountKgs: publicDecimal(input.sale.debtAmountKgs),
      clientTotalDebtKgs:
        typeof input.clientTotalDebtKgs === 'string'
          ? input.clientTotalDebtKgs
          : publicDecimal(input.clientTotalDebtKgs),
    };
  }

  formatReceiptText(payload: SaleReceiptPayload): string {
    const lines: string[] = [
      payload.businessName,
      '',
      `Чек №${payload.receiptNumber}`,
      `Продажа ${payload.saleNumber}`,
      new Date(payload.confirmedAt).toLocaleString('ru-RU'),
      '',
      `Клиент: ${payload.clientName}`,
      `Тип: ${payload.clientTypeLabel}`,
      `Категория: ${payload.clientCategoryLabel}`,
      '',
    ];

    for (const item of payload.items) {
      lines.push(
        `${item.productName} × ${item.quantity}     ${item.lineTotalKgs} KGS`,
      );
    }

    lines.push('-------------------------');
    lines.push(`Итого:             ${payload.totalAmountKgs} KGS`);
    lines.push('');
    lines.push('Оплата:');
    if (payload.payments.length === 0) {
      lines.push('—');
    } else {
      for (const p of payload.payments) {
        lines.push(`${p.methodName}:          ${p.amountKgs}`);
      }
    }
    lines.push('');
    lines.push(`Оплачено:          ${payload.paidAmountKgs}`);
    lines.push(`Долг по продаже:   ${payload.debtAmountKgs}`);
    if (dec(payload.clientTotalDebtKgs).gt(0)) {
      lines.push(`Текущий долг клиента: ${payload.clientTotalDebtKgs} KGS`);
    }
    return lines.join('\n');
  }

  async nextReceiptNumber(tx: Prisma.TransactionClient): Promise<string> {
    const rows = await tx.saleReceipt.findMany({
      where: { number: { startsWith: 'R-' } },
      select: { number: true },
    });
    let max = 0;
    for (const row of rows) {
      const match = row.number.match(/^R-(\d+)$/);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `R-${String(max + 1).padStart(5, '0')}`;
  }
}

@Injectable()
export class WhatsAppService {
  normalizePhone(phone: string): string | null {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 9) return null;
    if (digits.startsWith('996')) return digits;
    if (digits.length === 9) return `996${digits}`;
    return digits;
  }

  buildShareUrl(phone: string, text: string): string | null {
    const normalized = this.normalizePhone(phone);
    if (!normalized) return null;
    return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
  }
}
