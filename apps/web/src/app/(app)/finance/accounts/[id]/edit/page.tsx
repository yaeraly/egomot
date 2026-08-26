'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PaymentMethod } from '@/lib/types';
import { PageHeader } from '@/components/ui';
import { PaymentMethodForm } from '@/components/PaymentMethodForm';

export default function EditFinanceAccountPage() {
  const { id } = useParams<{ id: string }>();
  const [method, setMethod] = useState<PaymentMethod | null>(null);

  useEffect(() => {
    void api<PaymentMethod>(`/finance/accounts/${id}`).then(setMethod);
  }, [id]);

  if (!method) return <p className="text-muted">Загрузка…</p>;

  return (
    <div>
      <PageHeader title="Редактирование счёта" />
      <PaymentMethodForm method={method} />
    </div>
  );
}
