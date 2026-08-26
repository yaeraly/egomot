'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/format';
import { Sale } from '@/lib/types';
import { Badge, EmptyState, PageHeader, SearchBox } from '@/components/ui';

export default function SalesPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<Sale[]>([]);
  const [search, setSearch] = useState('');
  const isOwner = user?.role === 'OWNER';

  useEffect(() => {
    const t = setTimeout(() => {
      const q = search ? `?search=${encodeURIComponent(search)}` : '';
      void api<Sale[]>(`/sales${q}`).then(setItems);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div>
      <PageHeader
        title="Продажи"
        subtitle="POS и история продаж"
        action={
          <div className="flex gap-2">
            {isOwner ? (
              <Link href="/reports?tab=sales" className="inline-flex min-h-12 items-center rounded-xl border border-line px-4 font-semibold">
                Отчёт
              </Link>
            ) : (
              <Link href="/sales/balance" className="inline-flex min-h-12 items-center rounded-xl border border-line px-4 font-semibold">
                Мой баланс
              </Link>
            )}
            <Link href="/sales/new" className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white">
              + Продажа
            </Link>
          </div>
        }
      />
      <SearchBox value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по номеру или клиенту" />
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <EmptyState title="Нет продаж" text="Создайте первую продажу через POS" href="/sales/new" actionLabel="Новая продажа" />
        ) : (
          items.map((sale) => (
            <Link key={sale.id} href={`/sales/${sale.id}`} className="block rounded-2xl border border-line bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{sale.number}</p>
                  <p className="text-sm text-muted">{sale.client?.name ?? '—'}</p>
                </div>
                <Badge tone={sale.paymentStatus === 'PAID' ? 'green' : sale.debtAmountKgs !== '0.00' ? 'amber' : 'slate'}>
                  {sale.paymentStatus === 'PAID' ? 'Оплачено' : sale.debtAmountKgs !== '0.00' ? 'Долг' : sale.paymentStatus}
                </Badge>
              </div>
              <p className="mt-2 text-sm">
                Итого: {money(sale.totalAmountKgs)} · Оплачено: {money(sale.paidAmountKgs)}
                {sale.debtAmountKgs !== '0.00' ? ` · Долг: ${money(sale.debtAmountKgs)}` : ''}
              </p>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
