import { dec, roundWeight } from './purchase-calc';

export const DEFAULT_PURCHASE_NUMBER = 'ZG-2026-0004';
export const SOURCE_PRODUCT_NAME = 'Зарядка 60В 58Ач Шина 5.00–12';
export const TARGET_PRODUCT_NAME = 'Шина 5.00–12';
export const TARGET_UNIT_WEIGHT_KG = '6.000';
export const TARGET_PRODUCT_NOT_FOUND = 'TARGET PRODUCT NOT FOUND';

export interface PurchaseItemCandidate {
  productId: string;
  productName: string;
  productCode: string;
  quantity: string;
  unitWeightKg: string;
  unitPriceCny: string;
  unitLandedCostKgs: string;
}

export function normalizeProductName(value: string): string {
  return value
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function namesMatch(left: string, right: string): boolean {
  return normalizeProductName(left) === normalizeProductName(right);
}

export function findPurchaseItemByProductName(
  items: PurchaseItemCandidate[],
  productName: string,
): PurchaseItemCandidate | null {
  const matches = items.filter((item) => namesMatch(item.productName, productName));
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(`Multiple purchase items match "${productName}"`);
  }
  return matches[0];
}

export function resolveTargetLineWeight(quantity: string, unitWeightKg = TARGET_UNIT_WEIGHT_KG): {
  unitWeightKg: string;
  totalWeightKg: string;
} {
  const unit = roundWeight(unitWeightKg);
  return {
    unitWeightKg: unit.toFixed(3),
    totalWeightKg: roundWeight(dec(quantity).times(unit)).toFixed(3),
  };
}

export function formatProductCorrectionPreview(input: {
  purchaseNumber: string;
  current: PurchaseItemCandidate;
  newProductName: string;
  newUnitWeightKg: string;
  currentCargoKgs: string;
}): string {
  return [
    `Purchase: ${input.purchaseNumber}`,
    '',
    '1. PRODUCT NAME',
    `Current product: ${input.current.productName}`,
    `New product:     ${input.newProductName}`,
    '',
    '2. PRODUCT WEIGHT',
    `Current weight:  ${input.current.unitWeightKg} кг`,
    `New weight:      ${input.newUnitWeightKg} кг`,
    '',
    '3. CARGO PAYMENT',
    `Current cargo:   ${input.currentCargoKgs} KGS`,
    'Cargo amount was not specified in this request, so cargo payment is left unchanged.',
  ].join('\n');
}
