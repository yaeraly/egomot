'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { Purchase, PurchaseStatus, STATUS_LABELS } from '@/lib/types';
import { Badge, EmptyState, PageHeader, SearchBox, Select } from '@/components/ui';

const TONE: Record<PurchaseStatus, 'slate' | 'teal' | 'amber' | 'green' | 'blue'> = {
  DRAFT: 'slate',
  ORDERED: 'teal',
  PAID: 'green',
  IN_CHINA_TRANSIT: 'blue',
  HANDED_TO_CARGO: 'amber',
  IN_TRANSIT_TO_KYRGYZSTAN: 'blue',
  ARRIVED: 'green',
};

export default function PurchasesPage() {
  const [items, setItems] = useState<Purchase[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      const q = params.toString() ? `?${params}` : '';
      void api<Purchase[]>(`/purchases${q}`).then(setItems);
    }, 250);
    return () => clearTimeout(t);
  }, [search, status]);

  return (
    <div>
      <PageHeader
        title="Закупки"
        subtitle="Закупки из Китая"
        action={
          <Link href="/purchases/new" className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white">
            + Закупка
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SearchBox value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Номер или поставщик" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Все статусы</option>
          {(Object.keys(STATUS_LABELS) as PurchaseStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <EmptyState title="Нет закупок" text="Создайте закупку: поставщик, товары, курс и логистика" href="/purchases/new" actionLabel="Новая закупка" />
        ) : (
          items.map((p) => (
            <Link key={p.id} href={`/purchases/${p.id}`} className="block rounded-2xl border border-line bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{p.number}</p>
                <Badge tone={TONE[p.status]}>{STATUS_LABELS[p.status]}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted">{p.supplier?.name}</p>
              <p className="mt-1 text-sm">{money(p.estimatedTotalLandedCostKgs, 'KGS')}</p>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
