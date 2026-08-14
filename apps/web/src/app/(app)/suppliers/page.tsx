'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Supplier } from '@/lib/types';
import { Badge, EmptyState, PageHeader, SearchBox } from '@/components/ui';

export default function SuppliersPage() {
  const [items, setItems] = useState<Supplier[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      const q = search ? `?search=${encodeURIComponent(search)}` : '';
      void api<Supplier[]>(`/suppliers${q}`).then(setItems);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div>
      <PageHeader
        title="Поставщики"
        subtitle="Китайские поставщики"
        action={
          <Link href="/suppliers/new" className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white">
            + Поставщик
          </Link>
        }
      />
      <SearchBox value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по имени, телефону, WeChat, городу" />
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <EmptyState title="Нет поставщиков" text="Добавьте поставщика, чтобы создать закупку" href="/suppliers/new" actionLabel="Создать поставщика" />
        ) : (
          items.map((s) => (
            <Link key={s.id} href={`/suppliers/${s.id}`} className="block rounded-2xl border border-line bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{s.name}</p>
                <Badge tone={s.isActive ? 'green' : 'slate'}>{s.isActive ? 'Активен' : 'Неактивен'}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted">
                {s.companyName ? `${s.companyName} · ` : ''}
                {s.phone}
                {s.city ? ` · ${s.city}` : ''}
              </p>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
