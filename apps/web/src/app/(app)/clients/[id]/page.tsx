'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { ClientCard } from '@/lib/types';
import { Badge, Card, PageHeader } from '@/components/ui';

export default function ClientViewPage() {
  const { id } = useParams<{ id: string }>();
  const [card, setCard] = useState<ClientCard | null>(null);

  useEffect(() => {
    void api<ClientCard>(`/clients/${id}/card`).then(setCard);
  }, [id]);

  if (!card) return <p className="text-muted">Загрузка…</p>;

  const { client, pricing } = card;

  return (
    <div>
      <PageHeader
        title={client.name}
        action={
          <Link href={`/clients/${id}/edit`} className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white">
            Изменить
          </Link>
        }
      />

      <Card className="mb-4 space-y-2">
        <Badge tone={client.isActive ? 'green' : 'slate'}>{client.isActive ? 'Активен' : 'Неактивен'}</Badge>
        <p>Компания: {client.companyName || '—'}</p>
        <p>Телефон: {client.phone}</p>
        <p>Email: {client.email || '—'}</p>
        <p>Город: {client.city || '—'}</p>
        <p>Адрес: {client.address || '—'}</p>
        <p className="whitespace-pre-wrap">Заметки: {client.notes || '—'}</p>
      </Card>

      <Card className="mb-4 space-y-3">
        <h2 className="text-lg font-semibold">Ценообразование</h2>
        <div className="grid gap-2 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted">Тип:</span> {pricing.clientTypeLabel}
          </p>
          <p>
            <span className="text-muted">Категория:</span> {pricing.clientCategoryLabel}
          </p>
          <p>
            <span className="text-muted">Покупки за последние 90 дней:</span>{' '}
            {money(pricing.paidPurchaseAmount90DaysKgs)}
          </p>
          <p>
            <span className="text-muted">Дополнительная наценка:</span> {pricing.additionalMarkupPercent}%
          </p>
          <p>
            <span className="text-muted">Следующая категория:</span>{' '}
            {pricing.nextCategoryLabel ?? '—'}
          </p>
          {pricing.nextCategory ? (
            <p>
              <span className="text-muted">До {pricing.nextCategoryLabel}:</span>{' '}
              {money(pricing.amountRemainingToNextCategoryKgs ?? '0')}
            </p>
          ) : null}
        </div>
      </Card>

      {card.debt ? (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">Долг</h2>
          <p className="text-lg font-semibold text-amber-700">
            Текущий долг: {money(card.debt.currentDebtKgs)}
          </p>
          {card.debt.openSales.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">Непогашенные продажи</p>
              {card.debt.openSales.map((sale) => (
                <Link
                  key={sale.id}
                  href={`/sales/${sale.id}`}
                  className="block rounded-xl border border-line px-3 py-2 text-sm hover:bg-page"
                >
                  <p className="font-medium">Продажа {sale.number}</p>
                  <p className="text-muted">
                    Долг: {money(sale.debtAmountKgs)} · Итого: {money(sale.totalAmountKgs)}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Нет непогашенных продаж</p>
          )}
        </Card>
      ) : null}
    </div>
  );
}
