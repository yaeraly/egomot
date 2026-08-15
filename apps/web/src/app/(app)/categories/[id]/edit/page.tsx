'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Category } from '@/lib/types';
import { PageHeader } from '@/components/ui';
import { CategoryForm } from '@/components/CategoryForm';

export default function EditCategoryPage() {
  const { id } = useParams<{ id: string }>();
  const [category, setCategory] = useState<Category | null>(null);
  useEffect(() => {
    void api<Category>(`/categories/${id}`).then(setCategory);
  }, [id]);
  if (!category) return <p className="text-muted">Загрузка…</p>;
  return (
    <div>
      <PageHeader title="Редактирование категории" />
      <CategoryForm category={category} />
    </div>
  );
}
