'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { PaymentMethod } from '@/lib/types';
import { Badge, EmptyState, PageHeader } from '@/components/ui';

export default function FinanceAccountsPage() {
  const [items, setItems] = useState<PaymentMethod[]>([]);

  useEffect(() => {
    void api<PaymentMethod[]>('/finance/accounts').then(setItems);
  }, []);

  return (
    <div>
      <PageHeader
        title="Счета"
        subtitle="Финансы · способы оплаты для POS"
        action={
          <Link
            href="/finance/accounts/new"
            className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white"
          >
            + Счёт
          </Link>
        }
      />
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <EmptyState
            title="Нет счетов"
            text="Добавьте способ оплаты для использования в POS"
            href="/finance/accounts/new"
            actionLabel="Создать счёт"
          />
        ) : (
          items.map((item) => (
            <Link
              key={item.id}
              href={`/finance/accounts/${item.id}`}
              className="block rounded-2xl border border-line bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{item.name}</p>
                  <p className="mt-1 text-sm text-muted">{item.code}</p>
                </div>
                <Badge tone={item.isActive ? 'green' : 'slate'}>
                  {item.isActive ? 'Активен' : 'Архив'}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted">
                Операторов: {item.accountCount ?? 0} · Платежей: {item.paymentCount ?? 0}
              </p>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
