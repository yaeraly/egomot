'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { moneySom } from '@/lib/format';
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

  const rows: Array<[string, string | undefined, boolean?]> = [
    ['Выручка', data?.salesRevenueKgs],
    ['− Себестоимость проданных товаров', data?.cogsKgs],
    ['= Валовая прибыль', data?.grossProfitKgs, true],
    ['− Аренда склада', data?.warehouseRentKgs],
    ['− Канцтовары', data?.stationeryKgs],
    ['− Зарплата владельца', data?.ownerSalaryKgs],
    ['− Прочие операционные расходы', data?.otherOperatingExpensesKgs],
    ['= Чистая прибыль', data?.netProfitKgs, true],
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="ОПУ — Отчёт о прибылях и убытках"
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
        {rows.map(([label, value, strong]) => (
          <div key={label} className={`flex justify-between gap-3 text-sm ${strong ? 'font-semibold' : ''}`}>
            <span className={strong ? '' : 'text-muted'}>{label}</span>
            <span>{value === undefined ? '—' : moneySom(value)}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}
