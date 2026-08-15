import { ClientPricingCategory, ClientType } from '@prisma/client';

/** Default 90-day fully paid purchase category thresholds (KGS). */
export const DEFAULT_CATEGORY_THRESHOLDS = [
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
] as const;

/** Default Client Type × Client Category additional markup matrix (%). */
export const DEFAULT_MARKUP_MATRIX = [
  { clientType: ClientType.RETAIL, category: ClientPricingCategory.STANDARD, markupPercent: '15' },
  { clientType: ClientType.RETAIL, category: ClientPricingCategory.SILVER, markupPercent: '12' },
  { clientType: ClientType.RETAIL, category: ClientPricingCategory.GOLD, markupPercent: '10' },
  { clientType: ClientType.RETAIL, category: ClientPricingCategory.VIP, markupPercent: '8' },
  { clientType: ClientType.MASTER, category: ClientPricingCategory.STANDARD, markupPercent: '8' },
  { clientType: ClientType.MASTER, category: ClientPricingCategory.SILVER, markupPercent: '5' },
  { clientType: ClientType.MASTER, category: ClientPricingCategory.GOLD, markupPercent: '3' },
  { clientType: ClientType.MASTER, category: ClientPricingCategory.VIP, markupPercent: '1' },
  { clientType: ClientType.WHOLESALE, category: ClientPricingCategory.STANDARD, markupPercent: '5' },
  { clientType: ClientType.WHOLESALE, category: ClientPricingCategory.SILVER, markupPercent: '3' },
  { clientType: ClientType.WHOLESALE, category: ClientPricingCategory.GOLD, markupPercent: '1' },
  { clientType: ClientType.WHOLESALE, category: ClientPricingCategory.VIP, markupPercent: '0' },
] as const;
