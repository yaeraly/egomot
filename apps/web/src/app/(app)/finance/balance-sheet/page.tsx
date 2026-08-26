'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatBusinessDate, moneySom } from '@/lib/format';
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
      <PageHeader
        title="Баланс"
        subtitle={`Активы = Обязательства + Капитал. На дату ${
          data ? formatBusinessDate(data.asOf) : '—'
        }`}
      />
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
          <p className="font-semibold">АКТИВЫ</p>
          <Row k="Наличные" v={data?.assets.cashKgs} />
          <Row k="Банк" v={data?.assets.bankKgs} />
          <Row k="Дебиторская задолженность" v={data?.assets.accountsReceivableKgs} />
          <Row k="Товары на складе" v={data?.assets.inventoryKgs} />
          <Row k="Итого активы" v={data?.assets.totalAssetsKgs} strong />
        </Card>
        <Card className="space-y-2">
          <p className="font-semibold">ОБЯЗАТЕЛЬСТВА</p>
          <Row k="Долг поставщикам" v={data?.liabilities.supplierApKgs} />
          <Row k="Долг за карго" v={data?.liabilities.cargoApKgs} />
          <Row k="Итого обязательства" v={data?.liabilities.totalLiabilitiesKgs} strong />
        </Card>
        <Card className="space-y-2">
          <p className="font-semibold">КАПИТАЛ</p>
          <Row k="Капитал инвестора" v={data?.equity.investorCapitalKgs} />
          <Row k="Нераспределённая прибыль" v={data?.equity.retainedEarningsKgs} />
          <Row k="Изъятия владельца" v={data?.equity.ownerDrawingsKgs} />
          <Row k="Итого капитал" v={data?.equity.totalEquityKgs} strong />
        </Card>
      </div>
      {data ? (
        <Card className="space-y-1">
          <p className="text-sm">
            Активы = Обязательства + Капитал:{' '}
            <span className="font-semibold">{moneySom(data.liabilitiesPlusEquityKgs)}</span>
          </p>
          <p className="text-sm">
            Разница: <span className="font-semibold">{moneySom(data.differenceKgs)}</span>
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v?: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 text-sm ${strong ? 'font-semibold' : ''}`}>
      <span className={strong ? '' : 'text-muted'}>{k}</span>
      <span>{v === undefined ? '—' : moneySom(v)}</span>
    </div>
  );
}
