'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { money, qty } from '@/lib/format';
import { Card, PageHeader } from '@/components/ui';

interface InventoryValuation {
  totalValueKgs: string;
  skuCount: number;
  rows: Array<{
    productId: string;
    productCode: string;
    productName: string;
    quantity: string;
    averageUnitCostKgs: string;
    totalValueKgs: string;
  }>;
}

export default function InventoryValuationPage() {
  const [data, setData] = useState<InventoryValuation | null>(null);

  useEffect(() => {
    void api<InventoryValuation>('/accounting/reports/inventory-valuation').then(setData);
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader title="Оценка склада" subtitle="Количество × WAC. FIFO не используется." />
      <Card>
        <p className="text-sm text-muted">Стоимость склада</p>
        <p className="text-3xl font-bold">{data ? money(data.totalValueKgs, 'KGS') : '—'}</p>
      </Card>
      {(data?.rows ?? []).map((row) => (
        <Card key={row.productId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div>
            <p className="font-semibold">{row.productName}</p>
            <p className="text-muted">{row.productCode}</p>
          </div>
          <div className="flex gap-4 text-right">
            <div>
              <p className="text-muted">Кол-во</p>
              <p>{qty(row.quantity)}</p>
            </div>
            <div>
              <p className="text-muted">WAC</p>
              <p>{money(row.averageUnitCostKgs, 'KGS')}</p>
            </div>
            <div>
              <p className="text-muted">Сумма</p>
              <p>{money(row.totalValueKgs, 'KGS')}</p>
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
