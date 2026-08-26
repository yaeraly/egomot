import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };

export const MONEY_DP = 2;
export const ORIGINAL_AMOUNT_DP = 6;
export const WEIGHT_DP = 3;
export const RATE_DP = 6;
export const UNIT_COST_DP = 4;
export const QTY_DP = 3;

export type LogisticsType =
  | 'CHINA_INTERNAL_TRANSPORT'
  | 'CARGO'
  | 'KYRGYZSTAN_INTERNAL_TRANSPORT'
  | 'OTHER';

export type Currency = 'CNY' | 'KGS' | 'USD';

export function dec(value: Decimal.Value): Decimal {
  return new Decimal(value);
}

export function roundTo(value: Decimal.Value, dp: number): Decimal {
  return dec(value).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP);
}

export function roundMoney(value: Decimal.Value): Decimal {
  return roundTo(value, MONEY_DP);
}

export function roundOriginalAmount(value: Decimal.Value): Decimal {
  return roundTo(value, ORIGINAL_AMOUNT_DP);
}

export function roundWeight(value: Decimal.Value): Decimal {
  return roundTo(value, WEIGHT_DP);
}

export function roundQty(value: Decimal.Value): Decimal {
  return roundTo(value, QTY_DP);
}

export function roundRate(value: Decimal.Value): Decimal {
  return roundTo(value, RATE_DP);
}

export function roundUnitCost(value: Decimal.Value): Decimal {
  return roundTo(value, UNIT_COST_DP);
}

export function moneyStr(value: Decimal.Value): string {
  return roundMoney(value).toFixed(MONEY_DP);
}

export function amountStr(value: Decimal.Value): string {
  return roundOriginalAmount(value).toFixed(ORIGINAL_AMOUNT_DP);
}

export function weightStr(value: Decimal.Value): string {
  return roundWeight(value).toFixed(WEIGHT_DP);
}

export interface PurchaseItemInput {
  productId: string;
  quantity: Decimal.Value;
  unitPriceCny: Decimal.Value;
  unitWeightKg: Decimal.Value;
}

export interface LogisticsInput {
  type: LogisticsType;
  amount: Decimal.Value;
  currency: Currency;
  exchangeRate?: Decimal.Value | null;
  comment?: string | null;
}

export interface PurchaseCalcInput {
  items: PurchaseItemInput[];
  logistics: LogisticsInput[];
  exchangeRateCnyToKgs: Decimal.Value;
}

export interface CalculatedItem {
  productId: string;
  quantity: Decimal;
  unitPriceCny: Decimal;
  totalCny: Decimal;
  unitWeightKg: Decimal;
  totalWeightKg: Decimal;
  exchangeRateCnyToKgs: Decimal;
  purchaseCostKgs: Decimal;
  allocatedChinaTransportKgs: Decimal;
  allocatedCargoKgs: Decimal;
  allocatedKgInternalTransportKgs: Decimal;
  allocatedOtherLogisticsKgs: Decimal;
  totalAllocatedLogisticsKgs: Decimal;
  estimatedLandedCostKgs: Decimal;
  estimatedUnitLandedCostKgs: Decimal;
}

export interface CalculatedLogistics {
  type: LogisticsType;
  amount: Decimal;
  currency: Currency;
  exchangeRate: Decimal | null;
  amountKgs: Decimal;
  comment: string | null;
}

export interface PurchaseTotals {
  totalPositions: number;
  totalQuantity: Decimal;
  totalWeightKg: Decimal;
  totalPurchaseCny: Decimal;
  totalPurchaseCostKgs: Decimal;
  totalChinaTransportKgs: Decimal;
  totalCargoKgs: Decimal;
  totalKgInternalTransportKgs: Decimal;
  totalOtherLogisticsKgs: Decimal;
  totalLogisticsKgs: Decimal;
  estimatedTotalLandedCostKgs: Decimal;
  averageLogisticsCostPerKg: Decimal;
  exchangeRateCnyToKgs: Decimal;
}

export interface PurchaseCalculation {
  items: CalculatedItem[];
  logistics: CalculatedLogistics[];
  totals: PurchaseTotals;
}

export class PurchaseValidationError extends Error {
  constructor(public readonly messages: string[]) {
    super(messages.join('; '));
    this.name = 'PurchaseValidationError';
  }
}

export function logisticsAmountKgs(
  amount: Decimal.Value,
  currency: Currency,
  exchangeRate?: Decimal.Value | null,
): Decimal {
  const amt = dec(amount);
  if (currency === 'KGS') {
    return roundMoney(amt);
  }
  if (exchangeRate === undefined || exchangeRate === null || dec(exchangeRate).lte(0)) {
    throw new PurchaseValidationError([
      `Для валюты ${currency} требуется положительный курс обмена в KGS`,
    ]);
  }
  return roundMoney(amt.times(dec(exchangeRate)));
}

export function allocateByWeight(
  weights: Decimal[],
  totalAmount: Decimal,
): Decimal[] {
  const totalWeight = weights.reduce((sum, w) => sum.plus(w), dec(0));
  if (totalWeight.lte(0)) {
    if (totalAmount.eq(0)) {
      return weights.map(() => roundMoney(0));
    }
    throw new PurchaseValidationError([
      'Нельзя распределить логистику: общий вес закупки равен нулю',
    ]);
  }

  const roundedTotal = roundMoney(totalAmount);
  const result: Decimal[] = weights.map(() => roundMoney(0));
  const indexesWithWeight = weights
    .map((w, i) => ({ w, i }))
    .filter((x) => x.w.gt(0));

  let remaining = roundedTotal;
  for (let n = 0; n < indexesWithWeight.length; n++) {
    const { w, i } = indexesWithWeight[n];
    const isLast = n === indexesWithWeight.length - 1;
    if (isLast) {
      result[i] = remaining;
    } else {
      const allocated = roundMoney(w.div(totalWeight).times(roundedTotal));
      result[i] = allocated;
      remaining = remaining.minus(allocated);
    }
  }
  return result;
}

export function calculatePurchase(input: PurchaseCalcInput): PurchaseCalculation {
  const exchangeRate = roundRate(input.exchangeRateCnyToKgs);

  const items: CalculatedItem[] = input.items.map((item) => {
    const quantity = roundQty(item.quantity);
    const unitPriceCny = roundTo(item.unitPriceCny, 4);
    const unitWeightKg = roundWeight(item.unitWeightKg);
    const totalCny = roundMoney(quantity.times(unitPriceCny));
    const totalWeightKg = roundWeight(quantity.times(unitWeightKg));
    const purchaseCostKgs = roundMoney(totalCny.times(exchangeRate));

    return {
      productId: item.productId,
      quantity,
      unitPriceCny,
      totalCny,
      unitWeightKg,
      totalWeightKg,
      exchangeRateCnyToKgs: exchangeRate,
      purchaseCostKgs,
      allocatedChinaTransportKgs: roundMoney(0),
      allocatedCargoKgs: roundMoney(0),
      allocatedKgInternalTransportKgs: roundMoney(0),
      allocatedOtherLogisticsKgs: roundMoney(0),
      totalAllocatedLogisticsKgs: roundMoney(0),
      estimatedLandedCostKgs: roundMoney(0),
      estimatedUnitLandedCostKgs: roundUnitCost(0),
    };
  });

  const logistics: CalculatedLogistics[] = input.logistics.map((row) => ({
    type: row.type,
    amount: roundOriginalAmount(row.amount),
    currency: row.currency,
    exchangeRate:
      row.currency === 'KGS'
        ? row.exchangeRate != null
          ? roundRate(row.exchangeRate)
          : null
        : roundRate(row.exchangeRate ?? 0),
    amountKgs: logisticsAmountKgs(row.amount, row.currency, row.exchangeRate),
    comment: row.comment ?? null,
  }));

  const weights = items.map((item) => item.totalWeightKg);

  const sumByType = (type: LogisticsType): Decimal =>
    logistics
      .filter((row) => row.type === type)
      .reduce((sum, row) => sum.plus(row.amountKgs), dec(0));

  const chinaTotal = roundMoney(sumByType('CHINA_INTERNAL_TRANSPORT'));
  const cargoTotal = roundMoney(sumByType('CARGO'));
  const kgTotal = roundMoney(sumByType('KYRGYZSTAN_INTERNAL_TRANSPORT'));
  const otherTotal = roundMoney(sumByType('OTHER'));
  const logisticsTotal = roundMoney(
    chinaTotal.plus(cargoTotal).plus(kgTotal).plus(otherTotal),
  );

  const totalWeightKg = roundWeight(
    items.reduce((sum, item) => sum.plus(item.totalWeightKg), dec(0)),
  );

  if (logisticsTotal.gt(0)) {
    const missingWeight = items.some(
      (item) => item.unitWeightKg.lte(0) || item.totalWeightKg.lte(0),
    );
    if (missingWeight || totalWeightKg.lte(0)) {
      throw new PurchaseValidationError(['Не указан вес товара']);
    }
  }

  const chinaAlloc = allocateByWeight(weights, chinaTotal);
  const cargoAlloc = allocateByWeight(weights, cargoTotal);
  const kgAlloc = allocateByWeight(weights, kgTotal);
  const otherAlloc = allocateByWeight(weights, otherTotal);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    item.allocatedChinaTransportKgs = chinaAlloc[i];
    item.allocatedCargoKgs = cargoAlloc[i];
    item.allocatedKgInternalTransportKgs = kgAlloc[i];
    item.allocatedOtherLogisticsKgs = otherAlloc[i];
    item.totalAllocatedLogisticsKgs = roundMoney(
      item.allocatedChinaTransportKgs
        .plus(item.allocatedCargoKgs)
        .plus(item.allocatedKgInternalTransportKgs)
        .plus(item.allocatedOtherLogisticsKgs),
    );
    item.estimatedLandedCostKgs = roundMoney(
      item.purchaseCostKgs.plus(item.totalAllocatedLogisticsKgs),
    );
    item.estimatedUnitLandedCostKgs = item.quantity.gt(0)
      ? roundUnitCost(item.estimatedLandedCostKgs.div(item.quantity))
      : roundUnitCost(0);
  }

  const totalQuantity = roundQty(
    items.reduce((sum, item) => sum.plus(item.quantity), dec(0)),
  );
  const totalPurchaseCny = roundMoney(
    items.reduce((sum, item) => sum.plus(item.totalCny), dec(0)),
  );
  const totalPurchaseCostKgs = roundMoney(
    items.reduce((sum, item) => sum.plus(item.purchaseCostKgs), dec(0)),
  );
  const estimatedTotalLandedCostKgs = roundMoney(
    items.reduce((sum, item) => sum.plus(item.estimatedLandedCostKgs), dec(0)),
  );
  const averageLogisticsCostPerKg = totalWeightKg.gt(0)
    ? roundUnitCost(logisticsTotal.div(totalWeightKg))
    : roundUnitCost(0);

  return {
    items,
    logistics,
    totals: {
      totalPositions: items.length,
      totalQuantity,
      totalWeightKg,
      totalPurchaseCny,
      totalPurchaseCostKgs,
      totalChinaTransportKgs: chinaTotal,
      totalCargoKgs: cargoTotal,
      totalKgInternalTransportKgs: kgTotal,
      totalOtherLogisticsKgs: otherTotal,
      totalLogisticsKgs: logisticsTotal,
      estimatedTotalLandedCostKgs,
      averageLogisticsCostPerKg,
      exchangeRateCnyToKgs: exchangeRate,
    },
  };
}
