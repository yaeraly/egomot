export const FINANCE_CHART_ACCOUNT_LABELS: Record<string, string> = {
  '1000': 'Наличные',
  '1010': 'Банк',
  '1100': 'Дебиторская задолженность',
  '1200': 'Товары на складе',
  '2000': 'Долг поставщикам',
  '2010': 'Долг за карго',
  '2020': 'Долг за транспорт',
  '3000': 'Капитал инвестора',
  '3010': 'Изъятие владельца',
  '3020': 'Нераспределённая прибыль',
  '4000': 'Выручка',
  '5000': 'Себестоимость проданных товаров',
  '6000': 'Аренда склада',
  '6010': 'Канцтовары',
  '6020': 'Зарплата владельца',
  '6030': 'Прочие операционные расходы',
};

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
  WAREHOUSE_RENT: 'Аренда склада',
  STATIONERY: 'Канцтовары',
  OWNER_SALARY: 'Зарплата владельца',
  OTHER: 'Прочие операционные расходы',
};

export const PAYABLE_STATUS_LABELS: Record<string, string> = {
  UNPAID: 'Не оплачено',
  PARTIAL: 'Частично оплачено',
  PAID: 'Оплачено',
};

export function chartAccountLabel(code: string | undefined, fallback?: string) {
  if (code && FINANCE_CHART_ACCOUNT_LABELS[code]) return FINANCE_CHART_ACCOUNT_LABELS[code];
  return fallback ?? code ?? '';
}

export function companyAccountLabel(account: { name: string; paymentMethodCode?: string }) {
  if (account.paymentMethodCode === 'COMPANY_CASH') return 'Наличные';
  if (account.paymentMethodCode === 'COMPANY_BANK') return 'Банк';
  return account.name;
}
