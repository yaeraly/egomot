'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { money, qty } from '@/lib/format';
import { InventoryStock } from '@/lib/types';
import { Card, EmptyState, PageHeader, SearchBox } from '@/components/ui';

export default function WarehouseStockPage() {
  const [items, setItems] = useState<InventoryStock[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      const q = search ? `?search=${encodeURIComponent(search)}` : '';
      void api<InventoryStock[]>(`/inventory${q}`).then(setItems);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div>
      <PageHeader title="Остатки" subtitle="Складские остатки товаров" />
      <SearchBox value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Код или название" />
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <EmptyState title="Нет остатков" text="Остатки появятся после приёма товаров по закупкам" />
        ) : (
          items.map((row) => (
            <Card key={row.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold">{row.product.name}</p>
                  <p className="text-sm text-muted">{row.product.code}</p>
                </div>
                <p className="text-lg font-bold">{qty(row.quantity)} {row.product.unit}</p>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-muted">Себестоимость</p>
                  <p>{money(row.averageUnitCostKgs, 'KGS')}</p>
                </div>
                <div>
                  <p className="text-muted">Стоимость остатка</p>
                  <p>{money(row.totalValueKgs, 'KGS')}</p>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
