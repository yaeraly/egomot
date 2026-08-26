'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PaymentMethodDetail } from '@/lib/types';
import { Badge, Card, PageHeader } from '@/components/ui';

export default function FinanceAccountViewPage() {
  const { id } = useParams<{ id: string }>();
  const [method, setMethod] = useState<PaymentMethodDetail | null>(null);

  useEffect(() => {
    void api<PaymentMethodDetail>(`/finance/accounts/${id}`).then(setMethod);
  }, [id]);

  if (!method) return <p className="text-muted">Загрузка…</p>;

  return (
    <div>
      <PageHeader
        title={method.name}
        subtitle={`Код: ${method.code}`}
        action={
          <Link
            href={`/finance/accounts/${id}/edit`}
            className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white"
          >
            Изменить
          </Link>
        }
      />
      <Card className="mb-4 space-y-2">
        <Badge tone={method.isActive ? 'green' : 'slate'}>
          {method.isActive ? 'Активен' : 'Архив'}
        </Badge>
        <p>Порядок в POS: {method.sortOrder}</p>
        <p>Операторов: {method.accountCount ?? 0}</p>
        <p>Платежей: {method.paymentCount ?? 0}</p>
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold">Счета операторов</h2>
        {method.accounts.length === 0 ? (
          <p className="text-sm text-muted">Нет привязанных счетов</p>
        ) : (
          <div className="space-y-2">
            {method.accounts.map((account) => (
              <div key={account.id} className="rounded-xl border border-line px-3 py-2 text-sm">
                <p className="font-medium">{account.name}</p>
                <p className="text-muted">
                  {account.user.name} · {account.user.email} · {account.user.role}
                  {!account.user.isActive ? ' · деактивирован' : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
