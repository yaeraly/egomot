'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { DashboardSummary, STATUS_LABELS, PurchaseStatus } from '@/lib/types';
import { Badge, Card, PageHeader } from '@/components/ui';

const STATUS_TONE: Record<PurchaseStatus, 'slate' | 'teal' | 'amber' | 'green' | 'blue'> = {
  DRAFT: 'slate',
  ORDERED: 'teal',
  PAID: 'green',
  IN_CHINA_TRANSIT: 'blue',
  HANDED_TO_CARGO: 'amber',
  IN_TRANSIT_TO_KYRGYZSTAN: 'blue',
  ARRIVED: 'green',
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardSummary | null>(null);

  useEffect(() => {
    void api<DashboardSummary>('/dashboard/summary').then(setData);
  }, []);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Обзор товаров, поставщиков и закупок из Китая" />
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
