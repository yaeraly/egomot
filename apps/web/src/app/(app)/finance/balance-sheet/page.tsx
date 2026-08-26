'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { Card, PageHeader } from '@/components/ui';
import { FinanceRangeBar, useFinanceQuery } from '@/components/FinanceRange';

interface BalanceSheetReport {
  asOf: string;
  assets: {
    cashKgs: string;
    bankKgs: string;
    accountsReceivableKgs: string;
    inventoryKgs: string;
    totalAssetsKgs: string;
  };
  liabilities: {
    supplierApKgs: string;
    cargoApKgs: string;
    otherPayablesKgs: string;
    totalLiabilitiesKgs: string;
  };
  equity: {
    investorCapitalKgs: string;
    retainedEarningsKgs: string;
    ownerDrawingsKgs: string;
    totalEquityKgs: string;
  };
  liabilitiesPlusEquityKgs: string;
  differenceKgs: string;
}

export default function BalanceSheetPage() {
  const range = useFinanceQuery('month');
  const [data, setData] = useState<BalanceSheetReport | null>(null);

  useEffect(() => {
    void api<BalanceSheetReport>(`/accounting/reports/balance-sheet${range.query}`).then(setData);
  }, [range.query]);

  return (
    <div className="space-y-4">
      <PageHeader title="Баланс" subtitle="Assets = Liabilities + Equity. Разница должна быть 0.00" />
      <FinanceRangeBar
        preset={range.preset}
        from={range.from}
        to={range.to}
        setPreset={range.setPreset}
        setFrom={range.setFrom}
        setTo={range.setTo}
      />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="space-y-2">
          <p className="font-semibold">Assets</p>
          <Row k="Cash" v={data?.assets.cashKgs} />
          <Row k="Bank" v={data?.assets.bankKgs} />
          <Row k="Accounts Receivable" v={data?.assets.accountsReceivableKgs} />
          <Row k="Inventory" v={data?.assets.inventoryKgs} />
          <Row k="Total" v={data?.assets.totalAssetsKgs} />
        </Card>
        <Card className="space-y-2">
          <p className="font-semibold">Liabilities</p>
          <Row k="Supplier AP" v={data?.liabilities.supplierApKgs} />
          <Row k="Cargo AP" v={data?.liabilities.cargoApKgs} />
          <Row k="Other Payables" v={data?.liabilities.otherPayablesKgs} />
          <Row k="Total" v={data?.liabilities.totalLiabilitiesKgs} />
        </Card>
        <Card className="space-y-2">
          <p className="font-semibold">Equity</p>
          <Row k="Investor Capital" v={data?.equity.investorCapitalKgs} />
          <Row k="Retained Earnings" v={data?.equity.retainedEarningsKgs} />
          <Row k="− Owner Drawings" v={data?.equity.ownerDrawingsKgs} />
          <Row k="Total" v={data?.equity.totalEquityKgs} />
        </Card>
      </div>
      {data ? (
        <Card>
          <p className="text-sm">
            Разница: <span className="font-semibold">{money(data.differenceKgs, 'KGS')}</span>
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function Row({ k, v }: { k: string; v?: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-muted">{k}</span>
      <span className="font-medium">{v ? money(v, 'KGS') : '—'}</span>
    </div>
  );
}
