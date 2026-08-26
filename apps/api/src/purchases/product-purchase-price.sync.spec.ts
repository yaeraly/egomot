import {
  normalizedProductPurchasePriceCny,
  productPurchasePriceHistoryValues,
  shouldSyncProductPurchasePrice,
} from './product-purchase-price.sync';

describe('product purchase price sync', () => {
  it('detects price change at product card precision', () => {
    expect(shouldSyncProductPurchasePrice('85', '86')).toBe(true);
    expect(shouldSyncProductPurchasePrice('85', '85')).toBe(false);
    expect(shouldSyncProductPurchasePrice('85', '85.0049')).toBe(false);
    expect(shouldSyncProductPurchasePrice(null, '85')).toBe(true);
  });

  it('builds append-only history values', () => {
    const values = productPurchasePriceHistoryValues('85', '90');
    expect(values.previousPriceCny).toBe('85.00');
    expect(values.newPriceCny).toBe('90.00');
    expect(values.defaultPurchasePriceCny).toBe('90.00');
  });

  it('records first purchase price when product had none', () => {
    const values = productPurchasePriceHistoryValues(null, '85.5');
    expect(values.previousPriceCny).toBeNull();
    expect(values.newPriceCny).toBe('85.50');
    expect(normalizedProductPurchasePriceCny('85.5').toFixed(2)).toBe('85.50');
  });
});
