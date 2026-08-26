'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { moneySom } from '@/lib/format';
import { FinanceDashboard } from '@/lib/types';
import { PageHeader } from '@/components/ui';
import { FinanceDashboardCards } from '@/components/FinanceDashboardCards';
import { FinanceRangeBar, useFinanceQuery } from '@/components/FinanceRange';

export default function FinanceDashboardPage() {
  const range = useFinanceQuery('month');
  const [data, setData] = useState<FinanceDashboard | null>(null);

  useEffect(() => {
    void api<FinanceDashboard>(`/accounting/dashboard${range.query}`).then(setData);
  }, [range.query]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Финансы"
        subtitle="Показатели компании по бухгалтерскому учёту, не по кошелькам сотрудников"
      />
      <FinanceRangeBar
        preset={range.preset}
        from={range.from}
        to={range.to}
        setPreset={range.setPreset}
        setFrom={range.setFrom}
        setTo={range.setTo}
      />
      <FinanceDashboardCards data={data} />
      {data ? (
        <p className="text-sm text-muted">
          Активы − (Обязательства + Капитал) = {moneySom(data.balanceDifferenceKgs)}
        </p>
      ) : null}
    </div>
  );
}
