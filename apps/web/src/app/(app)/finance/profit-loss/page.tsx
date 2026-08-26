'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { Card, PageHeader } from '@/components/ui';
import { FinanceRangeBar, useFinanceQuery } from '@/components/FinanceRange';

interface ProfitLossReport {
  salesRevenueKgs: string;
  cogsKgs: string;
  grossProfitKgs: string;
  warehouseRentKgs: string;
  stationeryKgs: string;
  ownerSalaryKgs: string;
  otherOperatingExpensesKgs: string;
  operatingExpensesKgs: string;
  netProfitKgs: string;
}

export default function ProfitLossPage() {
  const range = useFinanceQuery('month');
  const [data, setData] = useState<ProfitLossReport | null>(null);

  useEffect(() => {
    void api<ProfitLossReport>(`/accounting/reports/profit-loss${range.query}`).then(setData);
  }, [range.query]);

  const rows: Array<[string, string | undefined]> = [
    ['Sales Revenue', data?.salesRevenueKgs],
    ['− COGS', data?.cogsKgs],
    ['= Gross Profit', data?.grossProfitKgs],
    ['− Warehouse Rent', data?.warehouseRentKgs],
    ['− Stationery', data?.stationeryKgs],
    ['− Owner Salary', data?.ownerSalaryKgs],
    ['− Other Operating Expenses', data?.otherOperatingExpensesKgs],
    ['= Operating / Net Profit', data?.netProfitKgs],
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="ОПУ"
        subtitle="Закупка товара, оплата поставщику и капитализированное карго не являются расходами периода"
      />
      <FinanceRangeBar
        preset={range.preset}
        from={range.from}
        to={range.to}
        setPreset={range.setPreset}
        setFrom={range.setFrom}
        setTo={range.setTo}
      />
      <Card className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 text-sm">
            <span className="text-muted">{label}</span>
            <span className="font-medium">{value ? money(value, 'KGS') : '—'}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
