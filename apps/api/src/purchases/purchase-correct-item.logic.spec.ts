import {
  formatProductCorrectionPreview,
  namesMatch,
  selectIncorrectPurchaseItem,
  TARGET_PRODUCT_NAME,
} from './purchase-correct-item.logic';

const charger = {
  productId: 'p-charger',
  productName: 'Зарядка 60В 58Ач',
  productCode: 'PRD-0007',
  quantity: '10.000',
  unitPriceCny: '50.00',
  unitLandedCostKgs: '720.0000',
};

const tire = {
  productId: 'p-tire',
  productName: 'Шина 5.00–12',
  productCode: 'PRD-0021',
  quantity: '8.000',
  unitPriceCny: '85.00',
  unitLandedCostKgs: '1400.0000',
};

const other = {
  productId: 'p-other',
  productName: 'Каска',
  productCode: 'PRD-0002',
  quantity: '1.000',
  unitPriceCny: '10.00',
  unitLandedCostKgs: '150.0000',
};

describe('purchase-correct-item.logic', () => {
  it('selects the only remaining incorrect item', () => {
    expect(selectIncorrectPurchaseItem([charger], TARGET_PRODUCT_NAME)).toEqual(charger);
  });

  it('selects a related charger line when other unrelated items exist', () => {
    expect(selectIncorrectPurchaseItem([charger, other], TARGET_PRODUCT_NAME)).toEqual(charger);
  });

  it('uses --from when two related products are present', () => {
    expect(
      selectIncorrectPurchaseItem([charger, tire], TARGET_PRODUCT_NAME, 'Шина 5.00-12'),
    ).toEqual(tire);
  });

  it('formats the required preview without changing cost', () => {
    expect(
      formatProductCorrectionPreview({
        purchaseNumber: 'ZG-2026-0004',
        current: charger,
        newProductName: TARGET_PRODUCT_NAME,
      }),
    ).toBe(
      [
        'Purchase: ZG-2026-0004',
        '',
        'Current product:',
        'Зарядка 60В 58Ач',
        '',
        'Current quantity:',
        '10.000',
        '',
        'Current cost price:',
        '720.0000',
        '',
        'New product:',
        'Зарядка 60В 58Ач Шина 5.00–12',
        '',
        'Cost price remains:',
        '720.0000',
      ].join('\n'),
    );
  });

  it('treats hyphen and en-dash product names as the same', () => {
    expect(namesMatch('Шина 5.00–12', 'Шина 5.00-12')).toBe(true);
  });
});
