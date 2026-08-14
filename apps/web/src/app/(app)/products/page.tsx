'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, assetUrl } from '@/lib/api';
import { money } from '@/lib/format';
import { Product } from '@/lib/types';
import { Badge, EmptyState, PageHeader, SearchBox } from '@/components/ui';

export default function ProductsPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      const q = search ? `?search=${encodeURIComponent(search)}` : '';
      void api<Product[]>(`/products${q}`).then(setItems);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div>
      <PageHeader
        title="Товары"
        subtitle="Каталог товаров для закупок из Китая"
        action={
          <Link href="/products/new" className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white">
            + Товар
          </Link>
        }
      />
      <SearchBox value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по названию, коду, категории" />
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <EmptyState title="Нет товаров" text="Создайте первый товар, чтобы добавлять его в закупки" href="/products/new" actionLabel="Создать товар" />
        ) : (
          items.map((p) => (
            <Link key={p.id} href={`/products/${p.id}`} className="block">
              <div className="flex gap-3 rounded-2xl border border-line bg-white p-3 shadow-sm">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-100">
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={assetUrl(p.imageUrl) ?? ''} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-muted">Нет фото</div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold leading-tight">{p.name}</p>
                    <Badge tone={p.isActive ? 'green' : 'slate'}>{p.isActive ? 'Активен' : 'Неактивен'}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {p.code} · {p.category.name} · {p.unit}
                  </p>
                  <p className="mt-1 text-sm">
                    {p.unitWeightKg} кг
                    {p.defaultPurchasePriceCny ? ` · ${money(p.defaultPurchasePriceCny, 'CNY')}` : ''}
                  </p>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
