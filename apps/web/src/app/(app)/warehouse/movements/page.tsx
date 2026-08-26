'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatBusinessDate, formatDate, money, qty } from '@/lib/format';
import { InventoryMovement } from '@/lib/types';
import { Card, EmptyState, PageHeader } from '@/components/ui';

export default function WarehouseMovementsPage() {
  const [items, setItems] = useState<InventoryMovement[]>([]);

  useEffect(() => {
    void api<InventoryMovement[]>('/inventory/movements').then(setItems);
  }, []);

  return (
    <div>
      <PageHeader title="Движения" subtitle="История складских движений" />
      <div className="space-y-3">
        {items.length === 0 ? (
          <EmptyState title="Нет движений" text="Движения появятся после приёма товаров" />
        ) : (
          items.map((row) => (
            <Card key={row.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{row.product.name}</p>
                  <p className="text-sm text-muted">{row.product.code}</p>
                </div>
                <p className="text-sm text-muted">{formatBusinessDate(row.transactionDate)}</p>
                <p className="text-xs text-muted">Введено: {formatDate(row.createdAt)}</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-muted">Дата поступления на склад</p>
                  <p>{formatBusinessDate(row.transactionDate)}</p>
                </div>
                <div>
                  <p className="text-muted">Количество</p>
                  <p>+{qty(row.quantity)}</p>
                </div>
                <div>
                  <p className="text-muted">Было → Стало</p>
                  <p>
                    {qty(row.previousQuantity)} → {qty(row.newQuantity)}
                  </p>
                </div>
                <div>
                  <p className="text-muted">Стоимость</p>
                  <p>{money(row.totalCost, 'KGS')}</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-muted">{row.user.name}</p>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
