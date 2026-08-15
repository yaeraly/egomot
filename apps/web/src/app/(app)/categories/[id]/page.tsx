'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate, money } from '@/lib/format';
import { Category, Product } from '@/lib/types';
import { Badge, PageHeader } from '@/components/ui';

export default function CategoryViewPage() {
  const { id } = useParams<{ id: string }>();
  const [category, setCategory] = useState<Category | null>(null);

  useEffect(() => {
    void api<Category>(`/categories/${id}`).then(setCategory);
  }, [id]);

  if (!category) return <p className="text-muted">Загрузка…</p>;

  const products = (category.products ?? []) as Product[];

  return (
    <div className="space-y-4">
      <PageHeader
        title={category.name}
        subtitle={`Товаров: ${category.productCount ?? products.length}`}
        action={
          <Link href={`/categories/${id}/edit`} className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white">
            Изменить
          </Link>
        }
      />
      <Badge tone={category.isActive ? 'green' : 'slate'}>{category.isActive ? 'Активна' : 'Неактивна'}</Badge>
      <p className="text-sm text-muted">Создана: {formatDate(category.createdAt)}</p>

      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Товары в категории</h2>
        {products.length === 0 ? (
          <p className="text-sm text-muted">В этой категории пока нет товаров</p>
        ) : (
          products.map((p) => (
            <Link key={p.id} href={`/products/${p.id}`} className="block rounded-2xl border border-line bg-white p-4 shadow-sm">
              <p className="font-semibold">{p.name}</p>
              <p className="mt-1 text-sm text-muted">
                {p.code} · {p.unitWeightKg} кг · {p.defaultPurchasePriceCny ? money(p.defaultPurchasePriceCny, 'CNY') : '—'}
              </p>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
