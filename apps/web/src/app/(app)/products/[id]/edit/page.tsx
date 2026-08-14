'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Product } from '@/lib/types';
import { PageHeader } from '@/components/ui';
import { ProductForm } from '@/components/ProductForm';

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  useEffect(() => {
    void api<Product>(`/products/${id}`).then(setProduct);
  }, [id]);
  if (!product) return <p className="text-muted">Загрузка…</p>;
  return (
    <div>
      <PageHeader title="Редактирование товара" subtitle={product.code} />
      <ProductForm product={product} />
    </div>
  );
}
