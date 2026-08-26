/** Chart of Accounts codes. Look up ChartAccount rows by code; never hard-code names in posting logic. */
export const ACCOUNT_CODE = {
  CASH: '1000',
  BANK: '1010',
  AR: '1100',
  INVENTORY: '1200',
  SUPPLIER_AP: '2000',
  CARGO_AP: '2010',
  INVESTOR_CAPITAL: '3000',
  OWNER_DRAWINGS: '3010',
  RETAINED_EARNINGS: '3020',
  SALES_REVENUE: '4000',
  COGS: '5000',
  WAREHOUSE_RENT: '6000',
  STATIONERY: '6010',
  OWNER_SALARY: '6020',
  OTHER_OPEX: '6030',
} as const;

export type AccountCode = (typeof ACCOUNT_CODE)[keyof typeof ACCOUNT_CODE];

export type ChartAccountTypeCode =
  | 'ASSET'
  | 'LIABILITY'
  | 'EQUITY'
  | 'INCOME'
  | 'COGS'
  | 'EXPENSE';

export const DEFAULT_CHART_ACCOUNTS: ReadonlyArray<{
  code: AccountCode;
  name: string;
  type: ChartAccountTypeCode;
  sortOrder: number;
}> = [
  { code: ACCOUNT_CODE.CASH, name: 'Cash', type: 'ASSET', sortOrder: 10 },
  { code: ACCOUNT_CODE.BANK, name: 'Bank', type: 'ASSET', sortOrder: 20 },
  { code: ACCOUNT_CODE.AR, name: 'Accounts Receivable', type: 'ASSET', sortOrder: 30 },
  { code: ACCOUNT_CODE.INVENTORY, name: 'Inventory', type: 'ASSET', sortOrder: 40 },
  {
    code: ACCOUNT_CODE.SUPPLIER_AP,
    name: 'Supplier Accounts Payable',
    type: 'LIABILITY',
    sortOrder: 50,
  },
  {
    code: ACCOUNT_CODE.CARGO_AP,
    name: 'Cargo Accounts Payable',
    type: 'LIABILITY',
    sortOrder: 60,
  },
  { code: ACCOUNT_CODE.INVESTOR_CAPITAL, name: 'Investor Capital', type: 'EQUITY', sortOrder: 70 },
  { code: ACCOUNT_CODE.OWNER_DRAWINGS, name: 'Owner Drawings', type: 'EQUITY', sortOrder: 80 },
  { code: ACCOUNT_CODE.RETAINED_EARNINGS, name: 'Retained Earnings', type: 'EQUITY', sortOrder: 90 },
  { code: ACCOUNT_CODE.SALES_REVENUE, name: 'Sales Revenue', type: 'INCOME', sortOrder: 100 },
  { code: ACCOUNT_CODE.COGS, name: 'COGS', type: 'COGS', sortOrder: 110 },
  { code: ACCOUNT_CODE.WAREHOUSE_RENT, name: 'Warehouse Rent', type: 'EXPENSE', sortOrder: 120 },
  { code: ACCOUNT_CODE.STATIONERY, name: 'Stationery', type: 'EXPENSE', sortOrder: 130 },
  { code: ACCOUNT_CODE.OWNER_SALARY, name: 'Owner Salary', type: 'EXPENSE', sortOrder: 140 },
  {
    code: ACCOUNT_CODE.OTHER_OPEX,
    name: 'Other Operating Expenses',
    type: 'EXPENSE',
    sortOrder: 150,
  },
];

export const EXPENSE_CATEGORY_ACCOUNT_CODE = {
  WAREHOUSE_RENT: ACCOUNT_CODE.WAREHOUSE_RENT,
  STATIONERY: ACCOUNT_CODE.STATIONERY,
  OWNER_SALARY: ACCOUNT_CODE.OWNER_SALARY,
  OTHER: ACCOUNT_CODE.OTHER_OPEX,
} as const;

export type OperatingExpenseCategoryCode = keyof typeof EXPENSE_CATEGORY_ACCOUNT_CODE;

/** Known opening investor capital. This is the only historical finance amount posted in phase 1. */
export const OPENING_INVESTOR_CAPITAL_KGS = '2584712.00';
export const OPENING_INVESTOR_CAPITAL_SOURCE_ID = 'INVESTOR_CAPITAL';

/** Operational employee-wallet total. Not company cash and never used as a GL plug. */
export const OPERATIONAL_WALLET_STATED_KGS = '9167215.00';

export const COMPANY_PAYMENT_METHOD_CODE = {
  CASH: 'COMPANY_CASH',
  BANK: 'COMPANY_BANK',
} as const;

export const COMPANY_PAYMENT_METHOD_CODES = [
  COMPANY_PAYMENT_METHOD_CODE.CASH,
  COMPANY_PAYMENT_METHOD_CODE.BANK,
] as const;

export const UNSPECIFIED_CARGO_VENDOR_NAME = 'Unspecified cargo vendor';

export const CASH_LIKE_PAYMENT_METHOD_CODES = new Set([
  'CASH',
  COMPANY_PAYMENT_METHOD_CODE.CASH,
]);

export function glCashAccountCodeForPaymentMethod(paymentMethodCode: string): AccountCode {
  if (CASH_LIKE_PAYMENT_METHOD_CODES.has(paymentMethodCode)) {
    return ACCOUNT_CODE.CASH;
  }
  return ACCOUNT_CODE.BANK;
}

export function isCompanyPaymentMethodCode(code: string): boolean {
  return (COMPANY_PAYMENT_METHOD_CODES as readonly string[]).includes(code);
}
