import Decimal from 'decimal.js';
import { ClientPricingCategory, ClientType } from '@prisma/client';
import {
  dec,
  roundMoney,
  roundTo,
  roundUnitCost,
} from '../purchases/purchase-calc';

export const MARKUP_DP = 4;
export const PRICE_DP = 4;

export type CategoryThresholdInput = {
  category: ClientPricingCategory;
  minPaidAmountKgs: Decimal.Value;
  maxPaidAmountKgs?: Decimal.Value | null;
  priority: number;
  isActive: boolean;
};

export type MarkupMatrixInput = {
  clientType: ClientType;
  category: ClientPricingCategory;
  markupPercent: Decimal.Value;
};

export interface PriceBreakdown {
  costPriceKgs: Decimal;
  baseMarkupPercent: Decimal;
  clientMarkupPercent: Decimal;
  finalMarkupPercent: Decimal;
  finalPriceKgs: Decimal;
  clientType: ClientType;
  clientCategory: ClientPricingCategory;
}

export interface NextCategoryInfo {
  nextCategory: ClientPricingCategory | null;
  amountRemainingKgs: Decimal | null;
}

export class PricingValidationError extends Error {
  constructor(public readonly messages: string[]) {
    super(messages.join('; '));
    this.name = 'PricingValidationError';
  }
}

export function roundMarkup(value: Decimal.Value): Decimal {
  return roundTo(value, MARKUP_DP);
}

export function roundPrice(value: Decimal.Value): Decimal {
  return roundUnitCost(value);
}

export function calculateFinalMarkup(
  baseMarkupPercent: Decimal.Value,
  clientMarkupPercent: Decimal.Value,
): Decimal {
  return roundMarkup(dec(baseMarkupPercent).plus(clientMarkupPercent));
}

export function calculateFinalPrice(
  costPriceKgs: Decimal.Value,
  finalMarkupPercent: Decimal.Value,
): Decimal {
  const cost = dec(costPriceKgs);
  const markup = dec(finalMarkupPercent);
  return roundPrice(cost.times(dec(1).plus(markup.div(100))));
}

export function buildPriceBreakdown(input: {
  costPriceKgs: Decimal.Value;
  baseMarkupPercent: Decimal.Value;
  clientMarkupPercent: Decimal.Value;
  clientType: ClientType;
  clientCategory: ClientPricingCategory;
}): PriceBreakdown {
  const finalMarkupPercent = calculateFinalMarkup(
    input.baseMarkupPercent,
    input.clientMarkupPercent,
  );
  return {
    costPriceKgs: roundPrice(input.costPriceKgs),
    baseMarkupPercent: roundMarkup(input.baseMarkupPercent),
    clientMarkupPercent: roundMarkup(input.clientMarkupPercent),
    finalMarkupPercent,
    finalPriceKgs: calculateFinalPrice(input.costPriceKgs, finalMarkupPercent),
    clientType: input.clientType,
    clientCategory: input.clientCategory,
  };
}

export function validateCategoryThresholds(
  thresholds: CategoryThresholdInput[],
): void {
  const active = thresholds
    .filter((row) => row.isActive)
    .map((row) => ({
      category: row.category,
      min: roundMoney(row.minPaidAmountKgs),
      max:
        row.maxPaidAmountKgs === null || row.maxPaidAmountKgs === undefined
          ? null
          : roundMoney(row.maxPaidAmountKgs),
      priority: row.priority,
    }));

  if (active.length === 0) {
    throw new PricingValidationError([
      'Должна быть активна хотя бы одна категория клиента',
    ]);
  }

  for (const row of active) {
    if (row.min.lt(0)) {
      throw new PricingValidationError([
        `Минимальная сумма для категории ${row.category} не может быть отрицательной`,
      ]);
    }
    if (row.max !== null && row.max.lt(row.min)) {
      throw new PricingValidationError([
        `Максимальная сумма для категории ${row.category} не может быть меньше минимальной`,
      ]);
    }
  }

  const sorted = [...active].sort((a, b) => {
    if (!a.min.eq(b.min)) return a.min.comparedTo(b.min);
    return a.priority - b.priority;
  });

  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const other = sorted[j];
      const currentMax = current.max ?? dec(Number.MAX_SAFE_INTEGER);
      const otherMax = other.max ?? dec(Number.MAX_SAFE_INTEGER);
      const overlaps = current.min.lte(otherMax) && other.min.lte(currentMax);
      if (overlaps) {
        throw new PricingValidationError([
          `Диапазоны категорий ${current.category} и ${other.category} пересекаются`,
        ]);
      }
    }
  }
}

export function resolveCategoryFromAmount(
  paidAmountKgs: Decimal.Value,
  thresholds: CategoryThresholdInput[],
  referenceDate = new Date(),
): ClientPricingCategory {
  void referenceDate;
  const amount = roundMoney(paidAmountKgs);
  const active = thresholds
    .filter((row) => row.isActive)
    .map((row) => ({
      category: row.category,
      min: roundMoney(row.minPaidAmountKgs),
      max:
        row.maxPaidAmountKgs === null || row.maxPaidAmountKgs === undefined
          ? null
          : roundMoney(row.maxPaidAmountKgs),
      priority: row.priority,
    }))
    .sort((a, b) => b.priority - a.priority || b.min.comparedTo(a.min));

  if (active.length === 0) {
    return ClientPricingCategory.STANDARD;
  }

  const matches = active.filter((row) => {
    const aboveMin = amount.gte(row.min);
    const belowMax = row.max === null || amount.lte(row.max);
    return aboveMin && belowMax;
  });

  if (matches.length === 0) {
    const lowest = [...active].sort((a, b) => a.min.comparedTo(b.min))[0];
    if (amount.lt(lowest.min)) {
      return lowest.category;
    }
    const highest = [...active].sort((a, b) => b.min.comparedTo(a.min))[0];
    return highest.category;
  }

  matches.sort((a, b) => b.priority - a.priority || b.min.comparedTo(a.min));
  return matches[0].category;
}

export function getNextCategoryInfo(
  paidAmountKgs: Decimal.Value,
  currentCategory: ClientPricingCategory,
  thresholds: CategoryThresholdInput[],
): NextCategoryInfo {
  const amount = roundMoney(paidAmountKgs);
  const active = thresholds
    .filter((row) => row.isActive)
    .map((row) => ({
      category: row.category,
      min: roundMoney(row.minPaidAmountKgs),
      priority: row.priority,
    }))
    .sort((a, b) => a.min.comparedTo(b.min));

  const current = active.find((row) => row.category === currentCategory);
  if (!current) {
    return { nextCategory: null, amountRemainingKgs: null };
  }

  const higher = active.filter((row) => row.min.gt(current.min));
  if (higher.length === 0) {
    return { nextCategory: null, amountRemainingKgs: null };
  }

  const next = higher.sort((a, b) => a.min.comparedTo(b.min))[0];
  const remaining = roundMoney(next.min.minus(amount));
  return {
    nextCategory: next.category,
    amountRemainingKgs: remaining.lte(0) ? roundMoney(0) : remaining,
  };
}

export function findMatrixMarkup(
  matrix: MarkupMatrixInput[],
  clientType: ClientType,
  category: ClientPricingCategory,
): Decimal {
  const row = matrix.find(
    (m) => m.clientType === clientType && m.category === category,
  );
  return roundMarkup(row?.markupPercent ?? 0);
}

export function rolling90DayWindowStart(referenceDate: Date): Date {
  const start = new Date(referenceDate);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 89);
  return start;
}
