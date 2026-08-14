export type UserRole = 'OWNER';

export type PurchaseStatus =
  | 'DRAFT'
  | 'ORDERED'
  | 'PAID'
  | 'IN_CHINA_TRANSIT'
  | 'HANDED_TO_CARGO'
  | 'IN_TRANSIT_TO_KYRGYZSTAN'
  | 'ARRIVED';

export type LogisticsType =
  | 'CHINA_INTERNAL_TRANSPORT'
  | 'CARGO'
  | 'KYRGYZSTAN_INTERNAL_TRANSPORT'
  | 'OTHER';

export type Currency = 'CNY' | 'KGS' | 'USD';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface ProductCategory {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  category: ProductCategory;
  unit: string;
  imageUrl: string | null;
  unitWeightKg: string;
  defaultPurchasePriceCny: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Supplier {
  id: string;
  name: string;
  companyName: string | null;
  phone: string;
  wechat: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseItem {
  id: string;
  productId: string;
  product?: Product;
  quantity: string;
  unitPriceCny: string;
  totalCny: string;
  unitWeightKg: string;
  totalWeightKg: string;
  exchangeRateCnyToKgs: string;
  purchaseCostKgs: string;
  allocatedChinaTransportKgs: string;
  allocatedCargoKgs: string;
  allocatedKgInternalTransportKgs: string;
  allocatedOtherLogisticsKgs: string;
  totalAllocatedLogisticsKgs: string;
  estimatedLandedCostKgs: string;
  estimatedUnitLandedCostKgs: string;
}

export interface PurchaseLogistics {
  id: string;
  type: LogisticsType;
  amount: string;
  currency: Currency;
  exchangeRate: string | null;
  amountKgs: string;
  comment: string | null;
}

export interface Purchase {
  id: string;
  number: string;
  supplierId: string;
  supplier?: Supplier;
  status: PurchaseStatus;
  exchangeRateCnyToKgs: string;
  notes: string | null;
  totalPositions: number;
  totalQuantity: string;
  totalWeightKg: string;
  totalPurchaseCny: string;
  totalPurchaseCostKgs: string;
  totalChinaTransportKgs: string;
  totalCargoKgs: string;
  totalKgInternalTransportKgs: string;
  totalOtherLogisticsKgs: string;
  totalLogisticsKgs: string;
  estimatedTotalLandedCostKgs: string;
  averageLogisticsCostPerKg: string;
  items?: PurchaseItem[];
  logistics?: PurchaseLogistics[];
  createdAt: string;
  updatedAt: string;
}

export interface PurchasePreview {
  items: Omit<PurchaseItem, 'id' | 'product'>[];
  logistics: Omit<PurchaseLogistics, 'id'>[];
  totals: {
    totalPositions: number;
    totalQuantity: string;
    totalWeightKg: string;
    totalPurchaseCny: string;
    totalPurchaseCostKgs: string;
    totalChinaTransportKgs: string;
    totalCargoKgs: string;
    totalKgInternalTransportKgs: string;
    totalOtherLogisticsKgs: string;
    totalLogisticsKgs: string;
    estimatedTotalLandedCostKgs: string;
    averageLogisticsCostPerKg: string;
    exchangeRateCnyToKgs: string;
  };
}

export interface AuditLog {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
  user: { id: string; name: string; email: string };
}

export interface DashboardSummary {
  products: number;
  suppliers: number;
  purchases: number;
  statusCounts: Record<string, number>;
  recentPurchases: Array<{
    id: string;
    number: string;
    status: PurchaseStatus;
    supplierName: string;
    totalPurchaseCny: string;
    estimatedTotalLandedCostKgs: string;
    createdAt: string;
  }>;
}

export const STATUS_LABELS: Record<PurchaseStatus, string> = {
  DRAFT: 'Черновик',
  ORDERED: 'Заказано',
  PAID: 'Оплачено',
  IN_CHINA_TRANSIT: 'Транзит по Китаю',
  HANDED_TO_CARGO: 'Передано карго',
  IN_TRANSIT_TO_KYRGYZSTAN: 'В пути в КР',
  ARRIVED: 'Прибыло',
};

export const LOGISTICS_LABELS: Record<LogisticsType, string> = {
  CHINA_INTERNAL_TRANSPORT: 'Внутренняя доставка (Китай)',
  CARGO: 'Карго',
  KYRGYZSTAN_INTERNAL_TRANSPORT: 'Внутренняя доставка (КР)',
  OTHER: 'Прочие расходы',
};

export const UNITS = ['шт', 'кг', 'кор', 'пар', 'набор', 'уп', 'м'];
