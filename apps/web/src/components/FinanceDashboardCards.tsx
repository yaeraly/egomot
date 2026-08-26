'use client';

import { money } from '@/lib/format';
import { FinanceDashboard } from '@/lib/types';
import { Card } from '@/components/ui';

export const FINANCE_DASHBOARD_CARDS: Array<{
  key: keyof FinanceDashboard;
  label: string;
  testId: string;
}> = [
  { key: 'companyCashKgs', label: 'Company Cash', testId: 'company-cash' },
  { key: 'companyBankKgs', label: 'Company Bank', testId: 'company-bank' },
  { key: 'investorCapitalKgs', label: 'Investor Capital', testId: 'investor-capital' },
  { key: 'accountsReceivableKgs', label: 'Accounts Receivable', testId: 'accounts-receivable' },
  { key: 'supplierDebtKgs', label: 'Supplier AP', testId: 'supplier-ap' },
  { key: 'cargoDebtKgs', label: 'Cargo AP', testId: 'cargo-ap' },
  { key: 'inventoryValueKgs', label: 'Inventory Value', testId: 'inventory-value' },
  { key: 'salesRevenueKgs', label: 'Revenue', testId: 'revenue' },
  { key: 'cogsKgs', label: 'COGS', testId: 'cogs' },
  { key: 'grossProfitKgs', label: 'Gross Profit', testId: 'gross-profit' },
  { key: 'operatingExpensesKgs', label: 'Operating Expenses', testId: 'operating-expenses' },
  { key: 'netProfitKgs', label: 'Net Profit', testId: 'net-profit' },
];

export function formatFinanceKgs(value: string | undefined) {
  if (value === undefined || value === '') return '—';
  return money(value, 'KGS');
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
