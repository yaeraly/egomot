'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Purchase } from '@/lib/types';
import { PageHeader } from '@/components/ui';
import { PurchaseWizard } from '@/components/PurchaseWizard';

export default function EditPurchasePage() {
  const { id } = useParams<{ id: string }>();
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  useEffect(() => {
    void api<Purchase>(`/purchases/${id}`).then(setPurchase);
  }, [id]);
  if (!purchase) return <p className="text-muted">Загрузка…</p>;
  return (
    <div>
      <PageHeader title={`Редактирование ${purchase.number}`} />
      <PurchaseWizard purchase={purchase} />
    </div>
  );
}
