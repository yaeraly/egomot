'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Client, CLIENT_TYPE_LABELS } from '@/lib/types';
import { Badge, EmptyState, PageHeader, SearchBox } from '@/components/ui';

export default function ClientsPage() {
  const [items, setItems] = useState<Client[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      const q = search ? `?search=${encodeURIComponent(search)}` : '';
      void api<Client[]>(`/clients${q}`).then(setItems);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div>
      <PageHeader
        title="Клиенты"
        subtitle="Розничные, мастера и оптовые покупатели"
        action={
          <Link href="/clients/new" className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white">
            + Клиент
          </Link>
        }
      />
      <SearchBox value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по имени, телефону, email, городу" />
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <EmptyState title="Нет клиентов" text="Добавьте клиента для расчёта цен" href="/clients/new" actionLabel="Создать клиента" />
        ) : (
          items.map((c) => (
            <Link key={c.id} href={`/clients/${c.id}`} className="block rounded-2xl border border-line bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{c.name}</p>
                <Badge tone={c.isActive ? 'green' : 'slate'}>{c.isActive ? 'Активен' : 'Неактивен'}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted">
                {CLIENT_TYPE_LABELS[c.clientType]}
                {c.companyName ? ` · ${c.companyName}` : ''}
                {' · '}
                {c.phone}
              </p>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
