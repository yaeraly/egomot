'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate, money, qty } from '@/lib/format';
import { PurchaseReceipt, PurchaseReceiptStatus, RECEIPT_STATUS_LABELS } from '@/lib/types';
import { Badge, EmptyState, PageHeader, SearchBox, Select } from '@/components/ui';

const TONE: Record<PurchaseReceiptStatus, 'slate' | 'teal' | 'amber' | 'green' | 'blue' | 'red'> = {
  DRAFT: 'slate',
  RECEIVING: 'blue',
  COMPLETED: 'green',
  CANCELLED: 'red',
};

export default function WarehouseReceiptsPage() {
  const [items, setItems] = useState<PurchaseReceipt[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      const q = params.toString() ? `?${params}` : '';
      void api<PurchaseReceipt[]>(`/purchase-receipts${q}`).then(setItems);
    }, 250);
    return () => clearTimeout(t);
  }, [search, status]);

  return (
    <div>
      <PageHeader
        title="Приход"
        subtitle="Приём товаров на склад"
        action={
          <Link
            href="/warehouse/receipts/new"
            className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white"
          >
            + Новый приход
          </Link>
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SearchBox value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Номер прихода или закупки" />
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Все статусы</option>
          {(Object.keys(RECEIPT_STATUS_LABELS) as PurchaseReceiptStatus[]).map((s) => (
            <option key={s} value={s}>
              {RECEIPT_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <EmptyState
            title="Нет приходов"
            text="Создайте приход по закупке, когда товар прибыл на склад"
            href="/warehouse/receipts/new"
            actionLabel="Новый приход"
          />
        ) : (
          items.map((row) => (
            <Link key={row.id} href={`/warehouse/receipts/${row.id}`} className="block rounded-2xl border border-line bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{row.number}</p>
                <Badge tone={TONE[row.status]}>{RECEIPT_STATUS_LABELS[row.status]}</Badge>
              </div>
              <p className="mt-1 text-sm text-muted">
                {row.purchase?.number} · {row.supplier?.name}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-muted">Принято</p>
                  <p>{qty(row.totalReceivedQuantity)}</p>
                </div>
                <div>
                  <p className="text-muted">Разница</p>
                  <p>{qty(row.totalDifference)}</p>
                </div>
                <div>
                  <p className="text-muted">Себестоимость</p>
                  <p>{money(row.totalLandedCostKgs, 'KGS')}</p>
                </div>
                <div>
                  <p className="text-muted">Дата</p>
                  <p>{formatDate(row.arrivalDate)}</p>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
