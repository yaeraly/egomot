'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { Card, PageHeader, Select } from '@/components/ui';
import { FinanceRangeBar, useFinanceQuery } from '@/components/FinanceRange';

interface CashFlowReport {
  range: { from: string; to: string; groupBy: string };
  openingCashKgs: string;
  investorContributionsKgs: string;
  cashSalesKgs: string;
  customerCollectionsKgs: string;
  otherCashInKgs: string;
  supplierPaymentsKgs: string;
  cargoPaymentsKgs: string;
  warehouseRentKgs: string;
  stationeryKgs: string;
  ownerSalaryKgs: string;
  ownerWithdrawalsKgs: string;
  otherCashOutKgs: string;
  totalCashInKgs: string;
  totalCashOutKgs: string;
  netCashKgs: string;
  closingCashKgs: string;
  glClosingCashKgs: string;
  differenceKgs: string;
}

export default function CashFlowPage() {
  const range = useFinanceQuery('month');
  const [groupBy, setGroupBy] = useState('range');
  const [data, setData] = useState<CashFlowReport | null>(null);

  useEffect(() => {
    const extra = `${range.query}${range.query ? '&' : '?'}groupBy=${groupBy}`;
    void api<CashFlowReport>(`/accounting/reports/cash-flow${extra}`).then(setData);
  }, [range.query, groupBy]);

  const rows: Array<[string, string | undefined]> = [
    ['Opening Cash', data?.openingCashKgs],
    ['+ Investor / Owner contributions', data?.investorContributionsKgs],
    ['+ Cash Sales', data?.cashSalesKgs],
    ['+ Customer debt collections', data?.customerCollectionsKgs],
    ['+ Other Cash In', data?.otherCashInKgs],
    ['− Supplier Payments', data?.supplierPaymentsKgs],
    ['− Cargo Payments', data?.cargoPaymentsKgs],
    ['− Warehouse Rent', data?.warehouseRentKgs],
    ['− Stationery', data?.stationeryKgs],
    ['− Owner Salary', data?.ownerSalaryKgs],
    ['− Owner Withdrawals', data?.ownerWithdrawalsKgs],
    ['− Other Cash Out', data?.otherCashOutKgs],
    ['= Closing Cash', data?.closingCashKgs],
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="ДДС" subtitle="Движение денежных средств по счетам Cash и Bank" />
      <FinanceRangeBar
        preset={range.preset}
        from={range.from}
        to={range.to}
        setPreset={range.setPreset}
        setFrom={range.setFrom}
        setTo={range.setTo}
      />
      <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
        <option value="range">За период</option>
        <option value="day">По дням</option>
        <option value="month">По месяцам</option>
      </Select>
      <Card className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 text-sm">
            <span className="text-muted">{label}</span>
            <span className="font-medium">{value ? money(value, 'KGS') : '—'}</span>
          </div>
        ))}
      </Card>
      {data ? (
        <p className="text-sm text-muted">
          Closing vs GL Cash/Bank: {money(data.glClosingCashKgs, 'KGS')} · разница{' '}
          {money(data.differenceKgs, 'KGS')}
        </p>
      ) : null}
    </div>
  );
}
