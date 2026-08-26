'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  datetimeLocalToIso,
  formatSaleDateTime,
  toDatetimeLocalValue,
} from '@/lib/datetime';
import { money } from '@/lib/format';
import { PaymentAccount, Sale, SaleReceiptView } from '@/lib/types';
import { Badge, Button, Card, ErrorText, Field, Input, PageHeader } from '@/components/ui';

export default function SaleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const isOwner = user?.role === 'OWNER';
  const [sale, setSale] = useState<Sale | null>(null);
  const [receipt, setReceipt] = useState<SaleReceiptView | null>(null);
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [debtPayAccountId, setDebtPayAccountId] = useState('');
  const [debtPayAmount, setDebtPayAmount] = useState('');
  const [saleDateTime, setSaleDateTime] = useState('');
  const [itemPrices, setItemPrices] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [s, r, a] = await Promise.all([
      api<Sale>(`/sales/${id}`),
      api<SaleReceiptView>(`/sales/${id}/receipt`),
      api<PaymentAccount[]>('/finance/my-accounts'),
    ]);
    setSale(s);
    setReceipt(r);
    setAccounts(a);
    setSaleDateTime(toDatetimeLocalValue(new Date(s.saleDate)));
    const prices: Record<string, string> = {};
    for (const item of s.items ?? []) {
      prices[item.id] = item.unitPriceKgs;
    }
    setItemPrices(prices);
    if (a[0]) setDebtPayAccountId(a[0].id);
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function payDebt() {
    if (!debtPayAccountId || !debtPayAmount) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/sales/${id}/debt-payments`, {
        method: 'POST',
        body: JSON.stringify({
          paymentAccountId: debtPayAccountId,
          amountKgs: debtPayAmount,
        }),
      });
      setDebtPayAmount('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось принять оплату');
    } finally {
      setBusy(false);
    }
  }

  async function saveSaleDate() {
    setBusy(true);
    setError(null);
    try {
      await api(`/sales/${id}/date`, {
        method: 'PATCH',
        body: JSON.stringify({ saleDate: datetimeLocalToIso(saleDateTime) }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить дату');
    } finally {
      setBusy(false);
    }
  }

  async function saveItemPrice(itemId: string) {
    setBusy(true);
    setError(null);
    try {
      await api(`/sales/${id}/items/${itemId}/price`, {
        method: 'PATCH',
        body: JSON.stringify({ unitPriceKgs: itemPrices[itemId] }),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить цену');
    } finally {
      setBusy(false);
    }
  }

  if (!sale || !receipt) return <p className="text-muted">Загрузка…</p>;

  const payload = receipt.payload;

  return (
    <div>
      <PageHeader
        title={`Продажа ${sale.number}`}
        action={<Link href="/sales" className="text-sm text-brand">← К списку</Link>}
      />

      <Card className="mb-4 space-y-2">
        <Badge tone={sale.paymentStatus === 'PAID' ? 'green' : 'amber'}>
          {sale.paymentStatus === 'PAID' ? 'Оплачено' : 'Есть долг'}
        </Badge>
        {sale.operator ? (
          <p>
            Оператор: {sale.operator.name}
            {sale.operator.roleLabel ? ` · ${sale.operator.roleLabel}` : ''}
          </p>
        ) : null}
        <p>Дата продажи: {formatSaleDateTime(sale.saleDate)}</p>
        <p>Клиент: {sale.client?.name}</p>
        <p>Тип: {payload.clientTypeLabel} · Категория: {payload.clientCategoryLabel}</p>
        <p>Итого: {money(sale.totalAmountKgs)}</p>
        <p>Оплачено: {money(sale.paidAmountKgs)}</p>
        <p>Долг по продаже: {money(sale.debtAmountKgs)}</p>
      </Card>

      {isOwner ? (
        <Card className="mb-4 space-y-4">
          <h2 className="font-semibold">Исторические данные (OWNER)</h2>
          <Field label="Дата и время продажи">
            <Input
              type="datetime-local"
              value={saleDateTime}
              onChange={(e) => setSaleDateTime(e.target.value)}
            />
          </Field>
          <Button disabled={busy} onClick={() => void saveSaleDate()}>
            Сохранить дату
          </Button>

          <div className="space-y-3 border-t border-line pt-4">
            <p className="text-sm font-medium">Цены позиций</p>
            {(sale.items ?? []).map((item) => (
              <div key={item.id} className="rounded-xl border border-line p-3">
                <p className="font-medium">{item.product?.name ?? item.productId}</p>
                <p className="text-xs text-muted">
                  Кол-во: {item.quantity} · Строка: {money(item.lineTotalKgs)}
                </p>
                <div className="mt-2 flex gap-2">
                  <Field label="Цена продажи">
                    <Input
                      inputMode="decimal"
                      value={itemPrices[item.id] ?? ''}
                      onChange={(e) =>
                        setItemPrices((prev) => ({ ...prev, [item.id]: e.target.value }))
                      }
                    />
                  </Field>
                  <Button
                    disabled={busy}
                    className="mt-6 shrink-0"
                    variant="secondary"
                    onClick={() => void saveItemPrice(item.id)}
                  >
                    Сохранить
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card className="mb-4">
        <h2 className="mb-3 font-semibold">Чек №{payload.receiptNumber}</h2>
        <pre className="whitespace-pre-wrap rounded-xl bg-page p-4 text-sm font-mono">{receipt.text}</pre>
        <div className="mt-4 flex flex-wrap gap-2">
          {receipt.whatsapp.available && receipt.whatsapp.url ? (
            <a
              href={receipt.whatsapp.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center rounded-xl bg-green-600 px-4 font-semibold text-white"
            >
              Отправить чек в WhatsApp
            </a>
          ) : (
            <p className="text-sm text-muted">Номер WhatsApp не указан.</p>
          )}
        </div>
        {receipt.whatsapp.phone ? (
          <p className="mt-2 text-sm text-muted">WhatsApp: {receipt.whatsapp.phone}</p>
        ) : null}
      </Card>

      {Number(sale.debtAmountKgs) > 0 ? (
        <Card className="space-y-3">
          <h2 className="font-semibold">Погашение долга</h2>
          <Field label="Счёт">
            <select
              className="min-h-11 w-full rounded-xl border border-line px-3"
              value={debtPayAccountId}
              onChange={(e) => setDebtPayAccountId(e.target.value)}
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.paymentMethod.name} — {acc.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Сумма">
            <Input inputMode="decimal" value={debtPayAmount} onChange={(e) => setDebtPayAmount(e.target.value)} />
          </Field>
          <ErrorText error={error} />
          <Button disabled={busy} onClick={() => void payDebt()}>
            Принять оплату долга
          </Button>
        </Card>
      ) : (
        <ErrorText error={error} />
      )}
    </div>
  );
}
