'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { money, moneySom } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { DashboardSummary, FinanceDashboard, STATUS_LABELS, PurchaseStatus } from '@/lib/types';
import { Badge, Card, PageHeader } from '@/components/ui';
import { FinanceDashboardCards } from '@/components/FinanceDashboardCards';

const STATUS_TONE: Record<PurchaseStatus, 'slate' | 'teal' | 'amber' | 'green' | 'blue'> = {
  DRAFT: 'slate',
  ORDERED: 'teal',
  PAID: 'green',
  IN_CHINA_TRANSIT: 'blue',
  HANDED_TO_CARGO: 'amber',
  IN_TRANSIT_TO_KYRGYZSTAN: 'blue',
  ARRIVED: 'green',
  RECEIVED: 'green',
  RECEIVED_WITH_DISCREPANCY: 'amber',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [finance, setFinance] = useState<FinanceDashboard | null>(null);

  useEffect(() => {
    void api<DashboardSummary>('/dashboard/summary').then(setData);
  }, []);

  useEffect(() => {
    if (!isOwner) return;
    void api<FinanceDashboard>('/accounting/dashboard?preset=month')
      .then(setFinance)
      .catch(() => setFinance(null));
  }, [isOwner]);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Обзор товаров, поставщиков и закупок из Китая" />

      {isOwner ? (
        <section className="mb-8 space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Финансы компании</h2>
              <p className="text-sm text-muted">
                Остатки по плану счетов, не по кошелькам сотрудников
              </p>
            </div>
            <Link href="/finance" className="text-sm font-semibold text-brand">
              Открыть финансы
            </Link>
          </div>
          <FinanceDashboardCards data={finance} />
          {finance ? (
            <p className="text-sm text-muted">
              Активы − (Обязательства + Капитал) = {moneySom(finance.balanceDifferenceKgs)}
            </p>
          ) : null}
        </section>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat href="/products" label="Товары" value={data?.products ?? '—'} />
        <Stat href="/suppliers" label="Поставщики" value={data?.suppliers ?? '—'} />
        <Stat href="/purchases" label="Закупки" value={data?.purchases ?? '—'} />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Link href="/purchases/new" className="rounded-2xl bg-brand p-4 font-semibold text-white">
          + Новая закупка
        </Link>
        <Link href="/products/new" className="rounded-2xl border border-line bg-white p-4 font-semibold">
          + Новый товар
        </Link>
        <Link href="/suppliers/new" className="rounded-2xl border border-line bg-white p-4 font-semibold">
          + Новый поставщик
        </Link>
      </div>

      <h2 className="mt-8 mb-3 text-lg font-semibold">Последние закупки</h2>
      <div className="space-y-3">
        {data?.recentPurchases.length ? (
          data.recentPurchases.map((p) => (
            <Link key={p.id} href={`/purchases/${p.id}`}>
              <Card className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold">{p.number}</p>
                  <p className="truncate text-sm text-muted">{p.supplierName}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[p.status]}>{STATUS_LABELS[p.status]}</Badge>
                  <span className="text-sm">{money(p.estimatedTotalLandedCostKgs, 'KGS')}</span>
                </div>
              </Card>
            </Link>
          ))
        ) : (
          <Card>
            <p className="text-sm text-muted">Пока нет закупок</p>
          </Card>
        )}
      </div>
    </div>
  );
}

function Stat({ href, label, value }: { href: string; label: string; value: number | string }) {
  return (
    <Link href={href}>
      <Card>
        <p className="text-sm text-muted">{label}</p>
        <p className="mt-1 text-3xl font-bold">{value}</p>
      </Card>
    </Link>
  );
}
