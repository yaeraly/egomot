export type UserRole = 'OWNER' | 'SALES' | 'WAREHOUSE';

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

export interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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
  baseMarkupPercent: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProductPurchasePriceHistoryEntry {
  id: string;
  previousPriceCny: string | null;
  newPriceCny: string;
  changedAt: string;
  purchase: { id: string; number: string } | null;
  changedBy: { id: string; name: string } | null;
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
  expenseDate?: string | null;
  payeeName?: string | null;
  amount: string;
  currency: Currency;
  exchangeRate: string | null;
  amountKgs: string;
  paidAmountKgs?: string;
  remainingAmountKgs?: string;
  status?: 'UNPAID' | 'PARTIAL' | 'PAID';
  paymentAccountId?: string | null;
  paymentAccount?: { id: string; name: string; paymentMethodCode?: string | null } | null;
  paidAt?: string | null;
  comment: string | null;
  journalId?: string | null;
}

export interface Purchase {
  id: string;
  number: string;
  supplierId: string;
  supplier?: Supplier;
  status: PurchaseStatus;
  exchangeRateCnyToKgs: string;
  notes: string | null;
  purchaseDate: string | null;
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
  paidAmountKgs?: string;
  unpaidAmountKgs?: string;
  payableStatus?: 'UNPAID' | 'PARTIAL' | 'PAID';
  supplierPaidAmountKgs?: string;
  supplierUnpaidAmountKgs?: string;
  logisticsPaidAmountKgs?: string;
  logisticsUnpaidAmountKgs?: string;
  chinaTransportPaidKgs?: string;
  chinaTransportUnpaidKgs?: string;
  cargoPaidKgs?: string;
  cargoUnpaidKgs?: string;
  kgInternalTransportPaidKgs?: string;
  kgInternalTransportUnpaidKgs?: string;
  totalUnpaidAmountKgs?: string;
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

export interface PurchaseReportProductRow {
  productId: string;
  productName: string;
  productCode: string;
  unit: string;
  quantity: string;
  totalAmountKgs: string;
  purchaseCostKgs: string;
  unitCostKgs: string;
}

export interface PurchaseReportMonthRow {
  monthKey: string;
  monthLabel: string;
  totalAmountKgs: string;
  totalQuantity: string;
  purchaseCount: number;
  products: PurchaseReportProductRow[];
}

export interface PurchaseReport {
  range: { preset: string; from: string; to: string };
  totals: {
    totalAmountKgs: string;
    totalQuantity: string;
    purchaseCount: number;
  };
  products: PurchaseReportProductRow[];
  months: PurchaseReportMonthRow[];
}

export interface SalesReportProductRow {
  productId: string;
  productName: string;
  productCode: string;
  unit: string;
  quantity: string;
  totalAmountKgs: string;
}

export interface SalesReportMonthRow {
  monthKey: string;
  monthLabel: string;
  totalAmountKgs: string;
  totalQuantity: string;
  saleCount: number;
  products: SalesReportProductRow[];
}

export interface SalesReport {
  range: { preset: string; from: string; to: string };
  totals: {
    totalAmountKgs: string;
    totalQuantity: string;
    saleCount: number;
  };
  months: SalesReportMonthRow[];
}

export interface FinanceDashboard {
  range: { from: string; to: string; preset?: string };
  companyCashKgs: string;
  companyBankKgs: string;
  investorCapitalKgs: string;
  inventoryValueKgs: string;
  accountsReceivableKgs: string;
  supplierDebtKgs: string;
  cargoDebtKgs: string;
  transportDebtKgs?: string;
  salesRevenueKgs: string;
  cogsKgs: string;
  grossProfitKgs: string;
  operatingExpensesKgs: string;
  netProfitKgs: string;
  balanceDifferenceKgs: string;
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

export interface InventoryStockSummary {
  totalQuantity: string;
  totalValueKgs: string;
  skuInStockCount: number;
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
  transactionDate: string | null;
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
  warehouseReceiptDate: string;
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

export const PAYABLE_STATUS_LABELS: Record<'UNPAID' | 'PARTIAL' | 'PAID', string> = {
  UNPAID: 'Не оплачено',
  PARTIAL: 'Частично оплачено',
  PAID: 'Оплачено',
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
  CHINA_INTERNAL_TRANSPORT: 'Транспорт по Китаю',
  CARGO: 'Карго Китай → Кыргызстан',
  KYRGYZSTAN_INTERNAL_TRANSPORT: 'Транспорт по Кыргызстану',
  OTHER: 'Прочие логистические расходы',
};

export const UNITS = ['шт', 'кг', 'кор', 'пар', 'набор', 'уп', 'м'];

export type ClientType = 'RETAIL' | 'MASTER' | 'WHOLESALE';

export type ClientPricingCategory = 'STANDARD' | 'SILVER' | 'GOLD' | 'VIP';

export interface Client {
  id: string;
  name: string;
  companyName: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  city: string | null;
  notes: string | null;
  clientType: ClientType;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClientPricingInfo {
  clientType: ClientType;
  clientCategory: ClientPricingCategory;
  clientTypeLabel: string;
  clientCategoryLabel: string;
  paidPurchaseAmount90DaysKgs: string;
  additionalMarkupPercent: string;
  nextCategory: ClientPricingCategory | null;
  nextCategoryLabel: string | null;
  amountRemainingToNextCategoryKgs: string | null;
}

export interface ClientCard {
  client: Client;
  pricing: ClientPricingInfo;
  debt?: ClientDebtSummary;
}

export interface ClientDebtSummary {
  currentDebtKgs: string;
  openSales: Array<{
    id: string;
    number: string;
    totalAmountKgs: string;
    paidAmountKgs: string;
    debtAmountKgs: string;
    confirmedAt: string | null;
    saleDate: string;
  }>;
  transactions: Array<{
    id: string;
    type: string;
    amountKgs: string;
    balanceAfterKgs: string;
    saleNumber: string | null;
    note: string | null;
    createdAt: string;
    recordedBy: { id: string; name: string };
  }>;
}

export interface CategoryThreshold {
  id: string;
  category: ClientPricingCategory;
  minPaidAmountKgs: string;
  maxPaidAmountKgs: string | null;
  priority: number;
  isActive: boolean;
}

export interface MarkupMatrixCell {
  id: string;
  clientType: ClientType;
  category: ClientPricingCategory;
  markupPercent: string;
}

export interface PricingSettings {
  thresholds: CategoryThreshold[];
  markupMatrix: MarkupMatrixCell[];
}

export interface PriceCalculation {
  productId: string;
  clientId: string;
  costPriceKgs: string;
  baseMarkupPercent: string;
  clientMarkupPercent: string;
  finalMarkupPercent: string;
  finalPriceKgs: string;
  clientType: ClientType;
  clientCategory: ClientPricingCategory;
  paidPurchaseAmount90DaysKgs: string;
  nextCategory: ClientPricingCategory | null;
  amountRemainingToNextCategoryKgs: string | null;
}

export const CLIENT_TYPE_LABELS: Record<ClientType, string> = {
  RETAIL: 'Розничный',
  MASTER: 'Мастер',
  WHOLESALE: 'Оптовый',
};

export const CLIENT_CATEGORY_LABELS: Record<ClientPricingCategory, string> = {
  STANDARD: 'Standard',
  SILVER: 'Silver',
  GOLD: 'Gold',
  VIP: 'VIP',
};

export type SaleStatus = 'DRAFT' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
export type SalePaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface PaymentMethod {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  sortOrder: number;
  accountCount?: number;
  paymentCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaymentMethodDetail extends PaymentMethod {
  accounts: Array<{
    id: string;
    name: string;
    isActive: boolean;
    user: {
      id: string;
      name: string;
      email: string;
      role: UserRole;
      isActive: boolean;
    };
  }>;
}

export interface PaymentAccount {
  id: string;
  userId: string;
  paymentMethodId: string;
  name: string;
  isActive: boolean;
  paymentMethod: PaymentMethod;
}

export interface EmployeeBalance {
  accounts: Array<{
    accountId: string;
    accountName: string;
    paymentMethodCode: string;
    paymentMethodName: string;
    balanceKgs: string;
  }>;
  totalBalanceKgs: string;
}

export interface SaleItem {
  id: string;
  productId: string;
  product?: Product;
  quantity: string;
  unitCostKgs: string;
  unitPriceKgs: string;
  lineTotalKgs: string;
  baseMarkupPercent: string;
  clientMarkupPercent: string;
  finalMarkupPercent: string;
}

export interface SalePayment {
  id: string;
  amountKgs: string;
  paidAt: string;
  paymentMethod?: PaymentMethod;
  paymentAccount?: PaymentAccount;
  receivedBy?: { id: string; name: string };
}

export interface Sale {
  id: string;
  number: string;
  clientId: string;
  client?: Client;
  soldByUserId: string | null;
  soldBy?: { id: string; name: string; email?: string; role?: UserRole } | null;
  operator?: { id: string; name: string; role?: UserRole; roleLabel?: string | null } | null;
  status: SaleStatus;
  paymentStatus: SalePaymentStatus;
  saleDate: string;
  totalAmountKgs: string;
  paidAmountKgs: string;
  debtAmountKgs: string;
  fullyPaidAt: string | null;
  confirmedAt: string | null;
  items?: SaleItem[];
  payments?: SalePayment[];
  createdAt: string;
  updatedAt: string;
}

export interface SalePreviewLine {
  productId: string;
  quantity: string;
  unitPriceKgs: string;
  lineTotalKgs: string;
  stockQuantity: string;
  pricing: PriceCalculation;
}

export interface SalePreview {
  client: Client;
  pricing: ClientPricingInfo;
  currentDebtKgs: string;
  debt?: {
    previousDebtKgs: string;
    openSales: ClientDebtSummary['openSales'];
  };
  items: SalePreviewLine[];
  totalAmountKgs: string;
}

export interface SaleReceiptView {
  receipt: { id: string; number: string; saleId: string; createdAt: string };
  payload: {
    businessName: string;
    receiptNumber: string;
    saleNumber: string;
    confirmedAt: string;
    employeeName: string;
    operatorRoleLabel: string;
    clientName: string;
    clientTypeLabel: string;
    clientCategoryLabel: string;
    items: Array<{ productName: string; productCode: string; quantity: string; unitPriceKgs: string; lineTotalKgs: string }>;
    totalAmountKgs: string;
    payments: Array<{ methodName: string; amountKgs: string }>;
    paidAmountKgs: string;
    debtAmountKgs: string;
    previousDebtKgs: string;
    newDebtKgs: string;
    clientTotalDebtKgs: string;
  };
  text: string;
  whatsapp: { phone: string; url: string | null; available: boolean };
}
