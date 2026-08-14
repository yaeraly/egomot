'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Supplier } from '@/lib/types';
import { Badge, Card, PageHeader } from '@/components/ui';

export default function SupplierViewPage() {
  const { id } = useParams<{ id: string }>();
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  useEffect(() => {
    void api<Supplier>(`/suppliers/${id}`).then(setSupplier);
  }, [id]);
  if (!supplier) return <p className="text-muted">Загрузка…</p>;
  return (
    <div>
      <PageHeader
        title={supplier.name}
        action={
          <Link href={`/suppliers/${id}/edit`} className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white">
            Изменить
          </Link>
        }
      />
      <Card className="space-y-2">
        <Badge tone={supplier.isActive ? 'green' : 'slate'}>{supplier.isActive ? 'Активен' : 'Неактивен'}</Badge>
        <p>Компания: {supplier.companyName || '—'}</p>
        <p>Телефон: {supplier.phone}</p>
        <p>WeChat: {supplier.wechat || '—'}</p>
        <p>Город: {supplier.city || '—'}</p>
        <p>Адрес: {supplier.address || '—'}</p>
        <p className="whitespace-pre-wrap">Заметки: {supplier.notes || '—'}</p>
      </Card>
    </div>
  );
}
