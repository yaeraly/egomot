import { ClientPricingCategory, ClientType } from '@prisma/client';
import {
  DEFAULT_CATEGORY_THRESHOLDS,
  DEFAULT_MARKUP_MATRIX,
} from '../../prisma/pricing-defaults';
import {
  validateCategoryThresholds,
} from './pricing-calc';

describe('pricing-defaults', () => {
  it('defines valid default category thresholds', () => {
    expect(DEFAULT_CATEGORY_THRESHOLDS).toHaveLength(4);
    expect(() =>
      validateCategoryThresholds(
        DEFAULT_CATEGORY_THRESHOLDS.map((row) => ({
          category: row.category,
          minPaidAmountKgs: row.minPaidAmountKgs,
          maxPaidAmountKgs: row.maxPaidAmountKgs,
          priority: row.priority,
          isActive: row.isActive,
        })),
      ),
    ).not.toThrow();
  });

  it('covers all client types and categories in markup matrix', () => {
    const types = new Set(DEFAULT_MARKUP_MATRIX.map((r) => r.clientType));
    const categories = new Set(DEFAULT_MARKUP_MATRIX.map((r) => r.category));
    expect(types).toEqual(
      new Set([ClientType.RETAIL, ClientType.MASTER, ClientType.WHOLESALE]),
    );
    expect(categories).toEqual(
      new Set([
        ClientPricingCategory.STANDARD,
        ClientPricingCategory.SILVER,
        ClientPricingCategory.GOLD,
        ClientPricingCategory.VIP,
      ]),
    );
    expect(DEFAULT_MARKUP_MATRIX).toHaveLength(12);
  });

  it('matches Wholesale + VIP zero additional markup', () => {
    const row = DEFAULT_MARKUP_MATRIX.find(
      (r) =>
        r.clientType === ClientType.WHOLESALE &&
        r.category === ClientPricingCategory.VIP,
    );
    expect(row?.markupPercent).toBe('0');
  });

  it('matches Master + VIP one percent additional markup', () => {
    const row = DEFAULT_MARKUP_MATRIX.find(
      (r) =>
        r.clientType === ClientType.MASTER &&
        r.category === ClientPricingCategory.VIP,
    );
    expect(row?.markupPercent).toBe('1');
  });
});
