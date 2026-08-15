'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { Category, Product } from '@/lib/types';
import { Badge, EmptyState, PageHeader, SearchBox, Select } from '@/components/ui';

export default function ProductsPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [active, setActive] = useState('');

  useEffect(() => {
    void api<Category[]>('/categories').then(setCategories);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (categoryId) params.set('categoryId', categoryId);
      if (active) params.set('active', active);
      const q = params.toString() ? `?${params}` : '';
      void api<Product[]>(`/products${q}`).then(setItems);
    }, 250);
    return () => clearTimeout(t);
  }, [search, categoryId, active]);

  return (
    <div>
      <PageHeader
        title="Товары"
        subtitle="Каталог товаров для закупок из Китая"
        action={
          <div className="flex flex-col gap-2 sm:flex-row">
            <Link href="/categories" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line bg-white px-4 font-semibold">
              Категории
            </Link>
            <Link href="/products/new" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-4 font-semibold text-white">
              + Добавить товар
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SearchBox value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск товара" />
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Все категории</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select value={active} onChange={(e) => setActive(e.target.value)}>
          <option value="">Все статусы</option>
          <option value="true">Активные</option>
          <option value="false">Неактивные</option>
        </Select>
      </div>

      <div className="mt-4 hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="py-2 pr-3">Код</th>
              <th className="py-2 pr-3">Товар</th>
              <th className="py-2 pr-3">Категория</th>
              <th className="py-2 pr-3">Вес, кг</th>
              <th className="py-2 pr-3">Цена CNY</th>
              <th className="py-2 pr-3">Статус</th>
              <th className="py-2">Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-b border-line">
                <td className="py-2 pr-3 font-mono text-xs">{p.code}</td>
                <td className="py-2 pr-3 font-medium">{p.name}</td>
                <td className="py-2 pr-3">{p.category.name}</td>
                <td className="py-2 pr-3">{p.unitWeightKg}</td>
                <td className="py-2 pr-3">{p.defaultPurchasePriceCny ? money(p.defaultPurchasePriceCny) : '—'}</td>
                <td className="py-2 pr-3">
                  <Badge tone={p.isActive ? 'green' : 'slate'}>{p.isActive ? 'Активен' : 'Неактивен'}</Badge>
                </td>
                <td className="py-2">
                  <Link href={`/products/${p.id}`} className="text-brand">
                    Открыть
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 space-y-3 md:hidden">
        {items.length === 0 ? (
          <EmptyState title="Нет товаров" text="Создайте первый товар или измените фильтры" href="/products/new" actionLabel="Создать товар" />
        ) : (
          items.map((p) => (
            <Link key={p.id} href={`/products/${p.id}`} className="block rounded-2xl border border-line bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{p.name}</p>
                  <p className="mt-1 text-xs text-muted">{p.code}</p>
                </div>
                <Badge tone={p.isActive ? 'green' : 'slate'}>{p.isActive ? 'Активен' : 'Неактивен'}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted">{p.category.name}</p>
              <p className="mt-1 text-sm">
                {p.unitWeightKg} кг · {p.defaultPurchasePriceCny ? money(p.defaultPurchasePriceCny, 'CNY') : '—'}
              </p>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
