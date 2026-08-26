'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatFinancePeriodKey, moneySom } from '@/lib/format';
import { Card, PageHeader, Select } from '@/components/ui';
import { FinanceRangeBar, useFinanceQuery } from '@/components/FinanceRange';

interface CashFlowBuckets {
  investorContributionsKgs: string;
  cashSalesKgs: string;
  customerCollectionsKgs: string;
  otherCashInKgs: string;
  supplierPaymentsKgs: string;
  chinaTransportPaymentsKgs: string;
  cargoPaymentsKgs: string;
  kyrgyzstanTransportPaymentsKgs: string;
  warehouseRentKgs: string;
  stationeryKgs: string;
  ownerSalaryKgs: string;
  ownerWithdrawalsKgs: string;
  otherCashOutKgs: string;
  totalCashInKgs: string;
  totalCashOutKgs: string;
  netCashKgs: string;
}

interface CashFlowReport extends CashFlowBuckets {
  range: { from: string; to: string; groupBy: string };
  openingCashKgs: string;
  closingCashKgs: string;
  glClosingCashKgs: string;
  differenceKgs: string;
  periods: Array<CashFlowBuckets & { key: string }>;
}

function Row({ label, value, strong }: { label: string; value?: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 text-sm ${strong ? 'font-semibold' : ''}`}>
      <span className={strong ? '' : 'text-muted'}>{label}</span>
      <span>{value === undefined ? '—' : moneySom(value)}</span>
    </div>
  );
}

export default function CashFlowPage() {
  const range = useFinanceQuery('month');
  const [groupBy, setGroupBy] = useState('day');
  const [data, setData] = useState<CashFlowReport | null>(null);

  useEffect(() => {
    const extra = `${range.query}${range.query ? '&' : '?'}groupBy=${groupBy}`;
    void api<CashFlowReport>(`/accounting/reports/cash-flow${extra}`).then(setData);
  }, [range.query, groupBy]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="ДДС — Отчёт о движении денежных средств"
        subtitle="Поступления и выплаты по счетам Наличные и Банк. Это не НДС."
      />
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
        <Row label="Остаток на начало периода" value={data?.openingCashKgs} strong />
        <p className="pt-2 text-sm font-semibold">+ Поступления</p>
        <Row label="Вклад инвестора" value={data?.investorContributionsKgs} />
        <Row label="Продажи" value={data?.cashSalesKgs} />
        <Row label="Погашение долгов клиентов" value={data?.customerCollectionsKgs} />
        {data && Number(data.otherCashInKgs) !== 0 ? (
          <Row label="Прочие поступления" value={data.otherCashInKgs} />
        ) : null}
        <Row label="Итого поступления" value={data?.totalCashInKgs} />
        <p className="pt-2 text-sm font-semibold">− Выплаты</p>
        <Row label="Оплата поставщикам" value={data?.supplierPaymentsKgs} />
        <Row label="Оплата транспорта по Китаю" value={data?.chinaTransportPaymentsKgs} />
        <Row label="Оплата карго" value={data?.cargoPaymentsKgs} />
        <Row label="Оплата транспорта по Кыргызстану" value={data?.kyrgyzstanTransportPaymentsKgs} />
        <Row label="Аренда склада" value={data?.warehouseRentKgs} />
        <Row label="Канцтовары" value={data?.stationeryKgs} />
        <Row label="Зарплата владельца" value={data?.ownerSalaryKgs} />
        <Row label="Изъятие владельца" value={data?.ownerWithdrawalsKgs} />
        <Row label="Прочие расходы" value={data?.otherCashOutKgs} />
        <Row label="Итого выплаты" value={data?.totalCashOutKgs} />
        <Row label="= Остаток на конец периода" value={data?.closingCashKgs} strong />
      </Card>
      {data?.periods?.length ? (
        <div className="space-y-3">
          {data.periods.map((period) => (
            <Card key={period.key} className="space-y-1">
              <p className="font-semibold">{formatFinancePeriodKey(period.key)}</p>
              {Number(period.investorContributionsKgs) !== 0 ? (
                <p className="text-sm">
                  Вклад инвестора — {moneySom(period.investorContributionsKgs)}
                </p>
              ) : null}
              {Number(period.cashSalesKgs) !== 0 ? (
                <p className="text-sm">Продажи — {moneySom(period.cashSalesKgs)}</p>
              ) : null}
              {Number(period.customerCollectionsKgs) !== 0 ? (
                <p className="text-sm">
                  Погашение долгов клиентов — {moneySom(period.customerCollectionsKgs)}
                </p>
              ) : null}
              {Number(period.supplierPaymentsKgs) !== 0 ? (
                <p className="text-sm">Оплата поставщикам — {moneySom(period.supplierPaymentsKgs)}</p>
              ) : null}
              {Number(period.chinaTransportPaymentsKgs) !== 0 ? (
                <p className="text-sm">
                  Оплата транспорта по Китаю — {moneySom(period.chinaTransportPaymentsKgs)}
                </p>
              ) : null}
              {Number(period.cargoPaymentsKgs) !== 0 ? (
                <p className="text-sm">Оплата карго — {moneySom(period.cargoPaymentsKgs)}</p>
              ) : null}
              {Number(period.kyrgyzstanTransportPaymentsKgs) !== 0 ? (
                <p className="text-sm">
                  Оплата транспорта по Кыргызстану — {moneySom(period.kyrgyzstanTransportPaymentsKgs)}
                </p>
              ) : null}
              {Number(period.warehouseRentKgs) !== 0 ? (
                <p className="text-sm">Аренда склада — {moneySom(period.warehouseRentKgs)}</p>
              ) : null}
              {Number(period.stationeryKgs) !== 0 ? (
                <p className="text-sm">Канцтовары — {moneySom(period.stationeryKgs)}</p>
              ) : null}
              {Number(period.ownerSalaryKgs) !== 0 ? (
                <p className="text-sm">Зарплата владельца — {moneySom(period.ownerSalaryKgs)}</p>
              ) : null}
              {Number(period.ownerWithdrawalsKgs) !== 0 ? (
                <p className="text-sm">Изъятие владельца — {moneySom(period.ownerWithdrawalsKgs)}</p>
              ) : null}
              {Number(period.otherCashOutKgs) !== 0 ? (
                <p className="text-sm">Прочие расходы — {moneySom(period.otherCashOutKgs)}</p>
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}
      {data ? (
        <p className="text-sm text-muted">
          Остаток по счетам Наличные и Банк: {moneySom(data.glClosingCashKgs)} · разница{' '}
          {moneySom(data.differenceKgs)}
        </p>
      ) : null}
    </div>
  );
}
