'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Supplier } from '@/lib/types';
import { PageHeader } from '@/components/ui';
import { SupplierForm } from '@/components/SupplierForm';

export default function EditSupplierPage() {
  const { id } = useParams<{ id: string }>();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  useEffect(() => {
    void api<Supplier>(`/suppliers/${id}`).then(setSupplier);
  }, [id]);
  if (!supplier) return <p className="text-muted">Загрузка…</p>;
  return (
    <div>
      <PageHeader title="Редактирование поставщика" />
      <SupplierForm supplier={supplier} />
    </div>
  );
}
