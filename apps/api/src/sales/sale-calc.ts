import Decimal from 'decimal.js';
import { dec, roundMoney, roundQty, roundUnitCost } from '../purchases/purchase-calc';

export class SaleValidationError extends Error {
  constructor(public readonly messages: string[]) {
    super(messages.join('; '));
    this.name = 'SaleValidationError';
  }
}

export function computeInventoryAfterSale(params: {
  currentQuantity: Decimal.Value;
  currentTotalValueKgs: Decimal.Value;
  soldQuantity: Decimal.Value;
}) {
  const prevQty = roundQty(params.currentQuantity);
  const soldQty = roundQty(params.soldQuantity);
  const prevValue = roundMoney(params.currentTotalValueKgs);

  if (soldQty.lte(0)) {
    throw new SaleValidationError(['Количество продажи должно быть больше нуля']);
  }
  if (soldQty.gt(prevQty)) {
    throw new SaleValidationError(['Недостаточно товара на складе']);
  }

  const avgCost = prevQty.gt(0) ? roundUnitCost(prevValue.div(prevQty)) : roundUnitCost(0);
  const removedValue = roundMoney(soldQty.times(avgCost));
  const newQty = roundQty(prevQty.minus(soldQty));
  const newValue = roundMoney(prevValue.minus(removedValue));

  return {
    previousQuantity: prevQty,
    newQuantity: newQty,
    unitCost: avgCost,
    totalCost: removedValue,
    newTotalValueKgs: newValue,
    averageUnitCostKgs: newQty.gt(0) ? roundUnitCost(newValue.div(newQty)) : roundUnitCost(0),
  };
}

/** Reverse a SALE stock-out using the existing WAC ledger values. */
export function computeInventoryAfterSaleReverse(params: {
  currentQuantity: Decimal.Value;
  currentTotalValueKgs: Decimal.Value;
  soldQuantity: Decimal.Value;
  saleTotalCostKgs: Decimal.Value;
}) {
  const prevQty = roundQty(params.currentQuantity);
  const soldQty = roundQty(params.soldQuantity);
  const prevValue = roundMoney(params.currentTotalValueKgs);
  const restoredValue = roundMoney(params.saleTotalCostKgs);

  if (soldQty.lte(0)) {
    throw new SaleValidationError(['Количество возврата на склад должно быть больше нуля']);
  }

  const newQty = roundQty(prevQty.plus(soldQty));
  const newValue = roundMoney(prevValue.plus(restoredValue));

  return {
    previousQuantity: prevQty,
    newQuantity: newQty,
    unitCost: soldQty.gt(0) ? roundUnitCost(restoredValue.div(soldQty)) : roundUnitCost(0),
    totalCost: restoredValue,
    newTotalValueKgs: newValue,
    averageUnitCostKgs: newQty.gt(0) ? roundUnitCost(newValue.div(newQty)) : roundUnitCost(0),
  };
}

export function calculateSaleDebt(totalAmountKgs: Decimal.Value, paidAmountKgs: Decimal.Value) {
  const total = roundMoney(totalAmountKgs);
  const paid = roundMoney(paidAmountKgs);
  if (paid.gt(total)) {
    throw new SaleValidationError(['Сумма оплат превышает сумму продажи']);
  }
  return roundMoney(total.minus(paid));
}

export function validatePaymentEntries(
  totalAmountKgs: Decimal.Value,
  payments: Array<{ amountKgs: Decimal.Value }>,
) {
  const total = roundMoney(totalAmountKgs);
  let paid = dec(0);
  for (const row of payments) {
    const amount = roundMoney(row.amountKgs);
    if (amount.lt(0)) {
      throw new SaleValidationError(['Сумма оплаты не может быть отрицательной']);
    }
    if (amount.gt(0)) {
      paid = paid.plus(amount);
    }
  }
  paid = roundMoney(paid);
  if (paid.gt(total)) {
    throw new SaleValidationError(['Сумма оплат превышает сумму продажи']);
  }
  return { paidAmountKgs: paid, debtAmountKgs: roundMoney(total.minus(paid)) };
}

export function resolvePaymentStatus(total: Decimal, paid: Decimal): 'UNPAID' | 'PARTIAL' | 'PAID' {
  if (paid.lte(0)) return 'UNPAID';
  if (paid.gte(total)) return 'PAID';
  return 'PARTIAL';
}
