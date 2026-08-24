export const DEFAULT_PURCHASE_NUMBER = 'ZG-2026-0004';
export const TARGET_PRODUCT_NAME = 'Зарядка 60В 58Ач Шина 5.00–12';

export interface PurchaseItemCandidate {
  productId: string;
  productName: string;
  productCode: string;
  quantity: string;
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

export function selectIncorrectPurchaseItem(
  items: PurchaseItemCandidate[],
  targetName: string,
  fromName?: string,
): PurchaseItemCandidate {
  if (!items.length) {
    throw new Error('Purchase has no items');
  }

  if (fromName) {
    const matches = items.filter((item) => namesMatch(item.productName, fromName));
    if (matches.length === 0) {
      throw new Error(`No purchase item matches --from "${fromName}"`);
    }
    if (matches.length > 1) {
      throw new Error(`Multiple purchase items match --from "${fromName}"`);
    }
    if (namesMatch(matches[0].productName, targetName)) {
      throw new Error(`Purchase item is already assigned to "${targetName}"`);
    }
    return matches[0];
  }

  const alreadyCorrect = items.filter((item) => namesMatch(item.productName, targetName));
  const remaining = items.filter((item) => !namesMatch(item.productName, targetName));

  if (remaining.length === 0) {
    throw new Error(`Purchase item is already assigned to "${targetName}"`);
  }

  if (remaining.length === 1) {
    return remaining[0];
  }

  const targetNorm = normalizeProductName(targetName);
  const related = remaining.filter((item) => {
    const name = normalizeProductName(item.productName);
    return targetNorm.includes(name) || name.includes(targetNorm);
  });

  if (related.length === 1) {
    return related[0];
  }

  const listed = remaining
    .map((item) => `  - ${item.productCode} ${item.productName} (qty ${item.quantity})`)
    .join('\n');
  throw new Error(
    `Could not uniquely identify the incorrect item. Re-run with --from "<current product name>".\n${listed}`,
  );
}

export function formatProductCorrectionPreview(input: {
  purchaseNumber: string;
  current: PurchaseItemCandidate;
  newProductName: string;
}): string {
  return [
    `Purchase: ${input.purchaseNumber}`,
    '',
    'Current product:',
    input.current.productName,
    '',
    'Current quantity:',
    input.current.quantity,
    '',
    'Current cost price:',
    input.current.unitLandedCostKgs,
    '',
    'New product:',
    input.newProductName,
    '',
    'Cost price remains:',
    input.current.unitLandedCostKgs,
  ].join('\n');
}

export function assertUnchangedFinancials(input: {
  before: {
    quantity: string;
    unitPriceCny: string;
    unitLandedCostKgs: string;
    purchaseTotalKgs: string;
  };
  after: {
    quantity: string;
    unitPriceCny: string;
    unitLandedCostKgs: string;
    purchaseTotalKgs: string;
  };
}): void {
  const checks: Array<[string, string, string]> = [
    ['quantity', input.before.quantity, input.after.quantity],
    ['purchase price', input.before.unitPriceCny, input.after.unitPriceCny],
    ['cost price', input.before.unitLandedCostKgs, input.after.unitLandedCostKgs],
    ['purchase total', input.before.purchaseTotalKgs, input.after.purchaseTotalKgs],
  ];
  const issues = checks
    .filter(([, left, right]) => left !== right)
    .map(([label, left, right]) => `${label} changed from ${left} to ${right}`);
  if (issues.length) {
    throw new Error(`Financial fields changed unexpectedly:\n${issues.join('\n')}`);
  }
}
