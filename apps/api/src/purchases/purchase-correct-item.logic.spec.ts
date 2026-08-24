import {
  findPurchaseItemByProductName,
  formatProductCorrectionPreview,
  namesMatch,
  resolveTargetLineWeight,
  SOURCE_PRODUCT_NAME,
  TARGET_PRODUCT_NAME,
  TARGET_UNIT_WEIGHT_KG,
} from './purchase-correct-item.logic';

const wrongName = {
  productId: 'p-wrong',
  productName: SOURCE_PRODUCT_NAME,
  productCode: 'PRD-0099',
  quantity: '10.000',
  unitWeightKg: '0.944',
  unitPriceCny: '85.00',
  unitLandedCostKgs: '1400.0000',
};

const tire = {
  productId: 'p-tire',
  productName: TARGET_PRODUCT_NAME,
  productCode: 'PRD-0021',
  quantity: '8.000',
  unitWeightKg: '6.000',
  unitPriceCny: '85.00',
  unitLandedCostKgs: '1400.0000',
};

describe('purchase-correct-item.logic', () => {
  it('finds the purchase item with the current wrong product name', () => {
    expect(findPurchaseItemByProductName([wrongName, tire], SOURCE_PRODUCT_NAME)).toEqual(
      wrongName,
    );
  });

  it('returns null when the source product is not on the purchase', () => {
    expect(findPurchaseItemByProductName([tire], SOURCE_PRODUCT_NAME)).toBeNull();
  });

  it('sets unit weight to 6.000 and total weight from quantity', () => {
    expect(resolveTargetLineWeight('10.000')).toEqual({
      unitWeightKg: TARGET_UNIT_WEIGHT_KG,
      totalWeightKg: '60.000',
    });
  });

  it('formats the name, weight, and cargo preview', () => {
    expect(
      formatProductCorrectionPreview({
        purchaseNumber: 'ZG-2026-0004',
        current: wrongName,
        newProductName: TARGET_PRODUCT_NAME,
        newUnitWeightKg: TARGET_UNIT_WEIGHT_KG,
        currentCargoKgs: '12000.00',
      }),
    ).toContain('New product:     Шина 5.00–12');
    expect(
      formatProductCorrectionPreview({
        purchaseNumber: 'ZG-2026-0004',
        current: wrongName,
        newProductName: TARGET_PRODUCT_NAME,
        newUnitWeightKg: TARGET_UNIT_WEIGHT_KG,
        currentCargoKgs: '12000.00',
      }),
    ).toContain('New weight:      6.000 кг');
  });

  it('treats hyphen and en-dash product names as the same', () => {
    expect(namesMatch('Шина 5.00–12', 'Шина 5.00-12')).toBe(true);
  });
});
