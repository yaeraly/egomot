export type UserRole = 'OWNER' | 'WAREHOUSE';

export type PurchaseStatus =
  | 'DRAFT'
  | 'ORDERED'
  | 'PAID'
  | 'IN_CHINA_TRANSIT'
  | 'HANDED_TO_CARGO'
  | 'IN_TRANSIT_TO_KYRGYZSTAN'
  | 'ARRIVED'
  | 'RECEIVED'
  | 'RECEIVED_WITH_DISCREPANCY';

export type PurchaseReceiptStatus = 'DRAFT' | 'RECEIVING' | 'COMPLETED' | 'CANCELLED';

export type ReceiptDiscrepancyType = 'SHORTAGE' | 'EXCESS';

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

export interface Category {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  productCount?: number;
  createdAt: string;
  updatedAt: string;
  products?: Product[];
}

export interface Product {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  category: Category;
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

export interface InventoryStock {
  id: string;
  productId: string;
  product: Product;
  quantity: string;
  averageUnitCostKgs: string;
  totalValueKgs: string;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryMovement {
  id: string;
  type: 'PURCHASE_RECEIPT';
  productId: string;
  product: Product;
  quantity: string;
  previousQuantity: string;
  newQuantity: string;
  unitCost: string;
  totalCost: string;
  referenceType: 'PURCHASE_RECEIPT';
  referenceId: string;
  user: { id: string; name: string; email: string };
  createdAt: string;
}

export interface PurchaseReceiptItem {
  id: string;
  productId: string;
  product?: Product;
  purchaseItemId: string;
  orderedQuantity: string;
  receivedQuantity: string;
  difference: string;
  unitPriceCny: string;
  unitWeightKg: string;
  totalWeightKg: string;
  purchaseCostKgs: string;
  allocatedChinaTransportKgs: string;
  allocatedCargoKgs: string;
  allocatedKgInternalTransportKgs: string;
  totalAllocatedTransportKgs: string;
  unitLandedCostKgs: string;
  totalLandedCostKgs: string;
}

export interface PurchaseReceiptDiscrepancy {
  id: string;
  productId: string;
  product?: Product;
  orderedQuantity: string;
  receivedQuantity: string;
  difference: string;
  type: ReceiptDiscrepancyType;
  comment: string | null;
}

export interface PurchaseReceipt {
  id: string;
  number: string;
  purchaseId: string;
  purchase?: Purchase;
  supplierId: string;
  supplier?: Supplier;
  arrivalDate: string;
  receivedByUserId: string;
  receivedBy?: AuthUser;
  status: PurchaseReceiptStatus;
  comment: string | null;
  exchangeRateCnyToKgs: string;
  chinaInternalTransportKgs: string;
  cargoKgs: string;
  kyrgyzstanInternalTransportKgs: string;
  totalTransportKgs: string;
  totalOrderedQuantity: string;
  totalReceivedQuantity: string;
  totalDifference: string;
  totalLandedCostKgs: string;
  items?: PurchaseReceiptItem[];
  discrepancies?: PurchaseReceiptDiscrepancy[];
  createdAt: string;
  updatedAt: string;
}

export interface ReceiptCalculationPreview {
  items: Array<Omit<PurchaseReceiptItem, 'id' | 'product' | 'purchaseItemId'>>;
  discrepancies: Array<Omit<PurchaseReceiptDiscrepancy, 'id' | 'product' | 'comment'>>;
  totals: {
    totalOrderedQuantity: string;
    totalReceivedQuantity: string;
    totalDifference: string;
    totalShortage: string;
    totalExcess: string;
    chinaInternalTransportKgs: string;
    cargoKgs: string;
    kyrgyzstanInternalTransportKgs: string;
    totalTransportKgs: string;
    totalLandedCostKgs: string;
    totalWeightKg: string;
    exchangeRateCnyToKgs: string;
  };
}

export const STATUS_LABELS: Record<PurchaseStatus, string> = {
  DRAFT: 'Черновик',
  ORDERED: 'Заказано',
  PAID: 'Оплачено',
  IN_CHINA_TRANSIT: 'Транзит по Китаю',
  HANDED_TO_CARGO: 'Передано карго',
  IN_TRANSIT_TO_KYRGYZSTAN: 'В пути в КР',
  ARRIVED: 'Прибыло',
  RECEIVED: 'Принято',
  RECEIVED_WITH_DISCREPANCY: 'Принято с расхождением',
};

export const RECEIPT_STATUS_LABELS: Record<PurchaseReceiptStatus, string> = {
  DRAFT: 'Черновик',
  RECEIVING: 'Приём',
  COMPLETED: 'Завершён',
  CANCELLED: 'Отменён',
};

export const DISCREPANCY_LABELS: Record<ReceiptDiscrepancyType, string> = {
  SHORTAGE: 'Недостача',
  EXCESS: 'Излишек',
};

export const LOGISTICS_LABELS: Record<LogisticsType, string> = {
  CHINA_INTERNAL_TRANSPORT: 'Внутренняя доставка (Китай)',
  CARGO: 'Карго',
  KYRGYZSTAN_INTERNAL_TRANSPORT: 'Внутренняя доставка (КР)',
  OTHER: 'Прочие расходы',
};

export const UNITS = ['шт', 'кг', 'кор', 'пар', 'набор', 'уп', 'м'];
