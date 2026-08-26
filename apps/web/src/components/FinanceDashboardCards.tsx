'use client';

import { moneySom } from '@/lib/format';
import { FinanceDashboard } from '@/lib/types';
import { Card } from '@/components/ui';

export const FINANCE_DASHBOARD_CARDS: Array<{
  key: keyof FinanceDashboard;
  label: string;
  testId: string;
}> = [
  { key: 'companyCashKgs', label: 'Наличные', testId: 'company-cash' },
  { key: 'companyBankKgs', label: 'Банк', testId: 'company-bank' },
  { key: 'inventoryValueKgs', label: 'Стоимость товаров на складе', testId: 'inventory-value' },
  { key: 'accountsReceivableKgs', label: 'Дебиторская задолженность', testId: 'accounts-receivable' },
  { key: 'supplierDebtKgs', label: 'Долг поставщикам', testId: 'supplier-ap' },
  { key: 'cargoDebtKgs', label: 'Долг за карго', testId: 'cargo-ap' },
  { key: 'investorCapitalKgs', label: 'Капитал инвестора', testId: 'investor-capital' },
  { key: 'salesRevenueKgs', label: 'Выручка', testId: 'revenue' },
  { key: 'cogsKgs', label: 'Себестоимость', testId: 'cogs' },
  { key: 'grossProfitKgs', label: 'Валовая прибыль', testId: 'gross-profit' },
  { key: 'operatingExpensesKgs', label: 'Операционные расходы', testId: 'operating-expenses' },
  { key: 'netProfitKgs', label: 'Чистая прибыль', testId: 'net-profit' },
];

export function formatFinanceKgs(value: string | undefined) {
  if (value === undefined || value === '') return '—';
  return moneySom(value);
}

export function FinanceDashboardCards({ data }: { data: FinanceDashboard | null }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {FINANCE_DASHBOARD_CARDS.map((card) => (
        <Card key={card.key}>
          <p className="text-sm text-muted">{card.label}</p>
          <p className="mt-1 text-2xl font-bold" data-testid={card.testId}>
            {formatFinanceKgs(data?.[card.key] as string | undefined)}
          </p>
        </Card>
      ))}
    </div>
  );
}
