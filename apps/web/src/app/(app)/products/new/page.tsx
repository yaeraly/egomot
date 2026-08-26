'use client';

import { PageHeader } from '@/components/ui';
import { ProductForm } from '@/components/ProductForm';

export default function NewProductPage() {
  return (
    <div>
      <PageHeader title="Новый товар" />
      <ProductForm />
    </div>
  );
}
