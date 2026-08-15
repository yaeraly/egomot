'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Category } from '@/lib/types';
import { Badge, EmptyState, PageHeader, SearchBox } from '@/components/ui';

export default function CategoriesPage() {
  const [items, setItems] = useState<Category[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      const q = search ? `?search=${encodeURIComponent(search)}` : '';
      void api<Category[]>(`/categories${q}`).then(setItems);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div>
      <PageHeader
        title="Категории"
        subtitle="Управление категориями товаров"
        action={
          <Link href="/categories/new" className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white">
            + Добавить категорию
          </Link>
        }
      />
      <SearchBox value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск категории" />

      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <EmptyState title="Нет категорий" text="Создайте первую категорию" href="/categories/new" actionLabel="Добавить категорию" />
        ) : (
          items.map((c) => (
            <Link key={c.id} href={`/categories/${c.id}`} className="block rounded-2xl border border-line bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{c.name}</p>
                  <p className="mt-1 text-sm text-muted">Товаров: {c.productCount ?? 0}</p>
                  <p className="mt-1 text-xs text-muted">Создана: {formatDate(c.createdAt)}</p>
                </div>
                <Badge tone={c.isActive ? 'green' : 'slate'}>{c.isActive ? 'Активна' : 'Неактивна'}</Badge>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
