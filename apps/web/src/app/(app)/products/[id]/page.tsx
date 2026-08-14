'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, assetUrl } from '@/lib/api';
import { money, weight } from '@/lib/format';
import { Product } from '@/lib/types';
import { Badge, Button, Card, PageHeader } from '@/components/ui';

export default function ProductViewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<Product | null>(null);

  useEffect(() => {
    void api<Product>(`/products/${id}`).then(setProduct);
  }, [id]);

  if (!product) return <p className="text-muted">Загрузка…</p>;

  async function deactivate() {
    const updated = await api<Product>(`/products/${id}/deactivate`, { method: 'POST' });
    setProduct(updated);
  }

  return (
    <div>
      <PageHeader
        title={product.name}
        subtitle={product.code}
        action={
          <Link href={`/products/${id}/edit`} className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white">
            Изменить
          </Link>
        }
      />
      <Card className="space-y-3">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(product.imageUrl) ?? ''} alt="" className="h-48 w-full rounded-xl object-cover" />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Badge tone={product.isActive ? 'green' : 'slate'}>{product.isActive ? 'Активен' : 'Неактивен'}</Badge>
          <Badge>{product.category.name}</Badge>
        </div>
        <p>Единица: {product.unit}</p>
        <p>Вес: {weight(product.unitWeightKg)}</p>
        <p>Цена CNY: {product.defaultPurchasePriceCny ? money(product.defaultPurchasePriceCny, 'CNY') : '—'}</p>
        {product.isActive ? (
          <Button variant="secondary" onClick={() => void deactivate()}>
            Деактивировать
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => router.push(`/products/${id}/edit`)}>
            Активировать в редактировании
          </Button>
        )}
      </Card>
    </div>
  );
}
