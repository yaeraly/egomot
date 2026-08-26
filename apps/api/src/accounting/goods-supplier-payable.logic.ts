import { Decimal, moneyStr, roundMoney } from '../purchases/purchase-calc';
import {
  payableStatusFromAmounts,
  remainingPayableAmount,
  type PayableStatusCode,
} from './accounting-journal.logic';

export const NO_SUPPLIER_DEBT_MESSAGE =
  'Нет долга поставщику по этой закупке. Обновите страницу «Долги».';
export const PAYMENT_EXCEEDS_REMAINING_MESSAGE = 'Сумма оплаты не может превышать остаток долга';
export const PAYMENT_AMOUNT_MUST_BE_POSITIVE_MESSAGE = 'Сумма оплаты должна быть больше 0';

export type GoodsSupplierPayableAmounts = {
  amountKgs: Decimal;
  paidAmountKgs: Decimal;
  remainingAmountKgs: Decimal;
  status: PayableStatusCode;
};

export type SupplierSettlement = {
  supplierPaidAmountKgs: string;
  supplierUnpaidAmountKgs: string;
  supplierPayableStatus: PayableStatusCode;
};

/**
 * Supplier AP is unpaid goods only. China transport, cargo and KG transport
 * are accepted so callers can prove they are excluded from 2000.
 */
export function computeGoodsSupplierPayable(params: {
  goodsKgs: Decimal.Value;
  verifiedSupplierPaidKgs: Decimal.Value;
  chinaTransportKgs?: Decimal.Value;
  cargoKgs?: Decimal.Value;
  kyrgyzstanTransportKgs?: Decimal.Value;
}): GoodsSupplierPayableAmounts {
  const amount = roundMoney(params.goodsKgs);
  const paid = Decimal.min(
    amount,
    Decimal.max(0, roundMoney(params.verifiedSupplierPaidKgs)),
  );
  return {
    amountKgs: amount,
    paidAmountKgs: roundMoney(paid),
    remainingAmountKgs: remainingPayableAmount(amount, paid),
    status: payableStatusFromAmounts(amount, paid),
  };
}

export function sumVerifiedSupplierPaidKgs(params: {
  purchasePaymentKgs?: Decimal.Value[];
  paidAtReceiptKgs?: Decimal.Value;
}): Decimal {
  const payments = (params.purchasePaymentKgs ?? []).reduce<Decimal>(
    (sum, row) => sum.plus(roundMoney(row)),
    roundMoney(0),
  );
  return roundMoney(payments.plus(roundMoney(params.paidAtReceiptKgs ?? 0)));
}

export function isPurchaseReceivedForSupplierAp(
  status: string,
  hasCompletedReceipt: boolean,
): boolean {
  return (
    hasCompletedReceipt ||
    status === 'RECEIVED' ||
    status === 'RECEIVED_WITH_DISCREPANCY'
  );
}

export function shouldBackfillSupplierPayable(params: {
  existingCount: number;
  received: boolean;
  remainingAmountKgs: Decimal.Value;
}): boolean {
  return (
    params.received &&
    params.existingCount === 0 &&
    roundMoney(params.remainingAmountKgs).gt(0)
  );
}

export function shouldRepairZeroedSupplierPayable(params: {
  existingRemainingKgs: Decimal.Value;
  goodsRemainingKgs: Decimal.Value;
}): boolean {
  return (
    !roundMoney(params.existingRemainingKgs).gt(0) &&
    roundMoney(params.goodsRemainingKgs).gt(0)
  );
}

export function settlementFromSupplierPayables(
  payables?:
    | Array<{
        paidAmountKgs: Decimal.Value;
        remainingAmountKgs: Decimal.Value;
        status?: string;
      }>
    | null,
): SupplierSettlement {
  if (!payables || payables.length === 0) {
    return {
      supplierPaidAmountKgs: moneyStr(0),
      supplierUnpaidAmountKgs: moneyStr(0),
      supplierPayableStatus: 'UNPAID',
    };
  }
  const paid = payables.reduce<Decimal>(
    (sum, row) => sum.plus(roundMoney(row.paidAmountKgs)),
    roundMoney(0),
  );
  const remaining = payables.reduce<Decimal>(
    (sum, row) => sum.plus(roundMoney(row.remainingAmountKgs)),
    roundMoney(0),
  );
  return {
    supplierPaidAmountKgs: moneyStr(paid),
    supplierUnpaidAmountKgs: moneyStr(remaining),
    supplierPayableStatus: payableStatusFromAmounts(paid.plus(remaining), paid),
  };
}

export function purchaseAndFinanceSupplierDebtMatch(params: {
  purchaseRemainingKgs: Decimal.Value;
  financeRemainingKgs: Decimal.Value;
}): boolean {
  return roundMoney(params.purchaseRemainingKgs).eq(roundMoney(params.financeRemainingKgs));
}

export function goodsApSourceId(purchaseId: string): string {
  return `goods-ap:${purchaseId}`;
}

export function purchaseIdFromGoodsApSource(sourceId: string): string | null {
  if (!sourceId.startsWith('goods-ap:')) return null;
  return sourceId.slice('goods-ap:'.length) || null;
}
