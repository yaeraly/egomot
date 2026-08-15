import { ClientPricingCategory, ClientType } from '@prisma/client';
import {
  buildPriceBreakdown,
  calculateFinalMarkup,
  calculateFinalPrice,
  findMatrixMarkup,
  getNextCategoryInfo,
  resolveCategoryFromAmount,
  rolling90DayWindowStart,
  validateCategoryThresholds,
  PricingValidationError,
} from './pricing-calc';

describe('pricing-calc', () => {
  const sampleThresholds = [
    {
      category: ClientPricingCategory.STANDARD,
      minPaidAmountKgs: '0',
      maxPaidAmountKgs: '49999.99',
      priority: 1,
      isActive: true,
    },
    {
      category: ClientPricingCategory.SILVER,
      minPaidAmountKgs: '50000',
      maxPaidAmountKgs: '149999.99',
      priority: 2,
      isActive: true,
    },
    {
      category: ClientPricingCategory.GOLD,
      minPaidAmountKgs: '150000',
      maxPaidAmountKgs: '299999.99',
      priority: 3,
      isActive: true,
    },
    {
      category: ClientPricingCategory.VIP,
      minPaidAmountKgs: '300000',
      maxPaidAmountKgs: null,
      priority: 4,
      isActive: true,
    },
  ];

  const sampleMatrix = [
    {
      clientType: ClientType.RETAIL,
      category: ClientPricingCategory.STANDARD,
      markupPercent: '15',
    },
    {
      clientType: ClientType.RETAIL,
      category: ClientPricingCategory.SILVER,
      markupPercent: '12',
    },
    {
      clientType: ClientType.RETAIL,
      category: ClientPricingCategory.GOLD,
      markupPercent: '10',
    },
    {
      clientType: ClientType.RETAIL,
      category: ClientPricingCategory.VIP,
      markupPercent: '8',
    },
    {
      clientType: ClientType.MASTER,
      category: ClientPricingCategory.STANDARD,
      markupPercent: '8',
    },
    {
      clientType: ClientType.MASTER,
      category: ClientPricingCategory.SILVER,
      markupPercent: '5',
    },
    {
      clientType: ClientType.MASTER,
      category: ClientPricingCategory.GOLD,
      markupPercent: '3',
    },
    {
      clientType: ClientType.MASTER,
      category: ClientPricingCategory.VIP,
      markupPercent: '1',
    },
    {
      clientType: ClientType.WHOLESALE,
      category: ClientPricingCategory.STANDARD,
      markupPercent: '5',
    },
    {
      clientType: ClientType.WHOLESALE,
      category: ClientPricingCategory.SILVER,
      markupPercent: '3',
    },
    {
      clientType: ClientType.WHOLESALE,
      category: ClientPricingCategory.GOLD,
      markupPercent: '1',
    },
    {
      clientType: ClientType.WHOLESALE,
      category: ClientPricingCategory.VIP,
      markupPercent: '0',
    },
  ];

  it('calculates final markup and price with decimal safety', () => {
    expect(calculateFinalMarkup('30', '0').toFixed(4)).toBe('30.0000');
    expect(calculateFinalPrice('10000', '30').toFixed(4)).toBe('13000.0000');
    expect(calculateFinalPrice('10000', '31').toFixed(4)).toBe('13100.0000');
    expect(calculateFinalPrice('10000', '45').toFixed(4)).toBe('14500.0000');
  });

  it('builds price breakdown for Master + VIP example', () => {
    const breakdown = buildPriceBreakdown({
      costPriceKgs: '10000',
      baseMarkupPercent: '30',
      clientMarkupPercent: '1',
      clientType: ClientType.MASTER,
      clientCategory: ClientPricingCategory.VIP,
    });
    expect(breakdown.finalMarkupPercent.toFixed(4)).toBe('31.0000');
    expect(breakdown.finalPriceKgs.toFixed(4)).toBe('13100.0000');
  });

  describe('Type × Category markup matrix', () => {
    const cases: Array<[ClientType, ClientPricingCategory, string]> = [
      [ClientType.RETAIL, ClientPricingCategory.STANDARD, '15.0000'],
      [ClientType.RETAIL, ClientPricingCategory.SILVER, '12.0000'],
      [ClientType.RETAIL, ClientPricingCategory.GOLD, '10.0000'],
      [ClientType.RETAIL, ClientPricingCategory.VIP, '8.0000'],
      [ClientType.MASTER, ClientPricingCategory.STANDARD, '8.0000'],
      [ClientType.MASTER, ClientPricingCategory.SILVER, '5.0000'],
      [ClientType.MASTER, ClientPricingCategory.GOLD, '3.0000'],
      [ClientType.MASTER, ClientPricingCategory.VIP, '1.0000'],
      [ClientType.WHOLESALE, ClientPricingCategory.STANDARD, '5.0000'],
      [ClientType.WHOLESALE, ClientPricingCategory.SILVER, '3.0000'],
      [ClientType.WHOLESALE, ClientPricingCategory.GOLD, '1.0000'],
      [ClientType.WHOLESALE, ClientPricingCategory.VIP, '0.0000'],
    ];

    it.each(cases)('%s + %s', (clientType, category, expected) => {
      expect(
        findMatrixMarkup(sampleMatrix, clientType, category).toFixed(4),
      ).toBe(expected);
    });
  });

  describe('90-day category thresholds', () => {
    it('assigns Standard for zero purchases', () => {
      expect(resolveCategoryFromAmount('0', sampleThresholds)).toBe(
        ClientPricingCategory.STANDARD,
      );
    });

    it('crosses Silver, Gold, VIP thresholds', () => {
      expect(resolveCategoryFromAmount('50000', sampleThresholds)).toBe(
        ClientPricingCategory.SILVER,
      );
      expect(resolveCategoryFromAmount('150000', sampleThresholds)).toBe(
        ClientPricingCategory.GOLD,
      );
      expect(resolveCategoryFromAmount('300000', sampleThresholds)).toBe(
        ClientPricingCategory.VIP,
      );
    });

    it('returns next category info', () => {
      const info = getNextCategoryInfo(
        '210000',
        ClientPricingCategory.GOLD,
        sampleThresholds,
      );
      expect(info.nextCategory).toBe(ClientPricingCategory.VIP);
      expect(info.amountRemainingKgs?.toFixed(2)).toBe('90000.00');
    });

    it('returns null next category at top tier', () => {
      const info = getNextCategoryInfo(
        '387000',
        ClientPricingCategory.VIP,
        sampleThresholds,
      );
      expect(info.nextCategory).toBeNull();
      expect(info.amountRemainingKgs).toBeNull();
    });
  });

  it('rejects overlapping thresholds', () => {
    expect(() =>
      validateCategoryThresholds([
        {
          category: ClientPricingCategory.STANDARD,
          minPaidAmountKgs: '0',
          maxPaidAmountKgs: '100000',
          priority: 1,
          isActive: true,
        },
        {
          category: ClientPricingCategory.SILVER,
          minPaidAmountKgs: '50000',
          maxPaidAmountKgs: null,
          priority: 2,
          isActive: true,
        },
      ]),
    ).toThrow(PricingValidationError);
  });

  it('uses rolling 90-day window start', () => {
    const ref = new Date('2026-08-15T12:00:00Z');
    const start = rolling90DayWindowStart(ref);
    expect(start.toISOString().slice(0, 10)).toBe('2026-05-18');
  });
});
