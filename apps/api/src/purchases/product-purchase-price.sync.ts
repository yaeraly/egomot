import Decimal from 'decimal.js';
import { roundMoney } from './purchase-calc';

export function normalizedProductPurchasePriceCny(value: Decimal.Value): Decimal {
  return roundMoney(value);
}

export function shouldSyncProductPurchasePrice(
  current: Decimal.Value | null | undefined,
  purchaseUnitPriceCny: Decimal.Value,
): boolean {
  const next = normalizedProductPurchasePriceCny(purchaseUnitPriceCny);
  if (current == null || current === '') return true;
  const prev = normalizedProductPurchasePriceCny(current);
  return !prev.eq(next);
}

export function productPurchasePriceHistoryValues(
  current: Decimal.Value | null | undefined,
  purchaseUnitPriceCny: Decimal.Value,
) {
  const next = normalizedProductPurchasePriceCny(purchaseUnitPriceCny);
  const previous =
    current == null || current === ''
      ? null
      : normalizedProductPurchasePriceCny(current);
  return {
    previousPriceCny: previous ? previous.toFixed(2) : null,
    newPriceCny: next.toFixed(2),
    defaultPurchasePriceCny: next.toFixed(2),
  };
}

export function pricesEqualForProductCard(
  current: Decimal.Value | null | undefined,
  purchaseUnitPriceCny: Decimal.Value,
): boolean {
  return !shouldSyncProductPurchasePrice(current, purchaseUnitPriceCny);
}
