'use client';

import { PageHeader } from '@/components/ui';
import { CategoryForm } from '@/components/CategoryForm';

export default function NewCategoryPage() {
  return (
    <div>
      <PageHeader title="Новая категория" />
      <CategoryForm />
    </div>
  );
}
