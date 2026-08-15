'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { defaultCustomRange, DateRangeFilter } from '@/components/DateRangeFilter';
import { Card, PageHeader } from '@/components/ui';
import { formatBusinessDate, money, qty } from '@/lib/format';
import { DatePresetValue, monthInputRange } from '@/lib/date';

type Tab = 'purchases' | 'receipts' | 'movements';

interface PurchaseReportRow {
  purchaseDate: string | null;
  supplierName: string;
  number: string;
  totalQuantity: string;
  totalPurchaseCny: string;
  totalLogisticsKgs: string;
  estimatedTotalLandedCostKgs: string;
  status: string;
  createdAt: string;
}

interface ReceiptReportRow {
  warehouseReceiptDate: string | null;
  purchaseNumber: string;
  purchaseDate: string | null;
  supplierName: string;
  totalOrderedQuantity: string;
  totalReceivedQuantity: string;
  totalShortage: string;
  totalExcess: string;
  totalTransportKgs: string;
  totalLandedCostKgs: string;
  receivedByName: string;
  number: string;
  createdAt: string;
}

interface MovementReportRow {
  transactionDate: string | null;
  productName: string;
  productCode: string;
  typeLabel: string;
  quantity: string;
  unitCost: string;
  totalCost: string;
  balanceAfter: string;
  referenceId: string;
  employeeName: string;
  createdAt: string;
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('purchases');
  const [preset, setPreset] = useState<DatePresetValue>('month');
  const [{ from, to }, setRange] = useState(defaultCustomRange);
  const [purchaseRows, setPurchaseRows] = useState<PurchaseReportRow[]>([]);
  const [receiptRows, setReceiptRows] = useState<ReceiptReportRow[]>([]);
  const [movementRows, setMovementRows] = useState<MovementReportRow[]>([]);
  const [missing, setMissing] = useState<{ summary: { purchasesWithoutDate: number; movementsWithoutTransactionDate: number } } | null>(null);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (preset === 'custom') {
      if (from) params.set('from', from);
      if (to) params.set('to', to);
    } else {
      params.set('preset', preset);
    }
    return params.toString() ? `?${params}` : '';
  }, [preset, from, to]);

  useEffect(() => {
    void api<{ summary: { purchasesWithoutDate: number; movementsWithoutTransactionDate: number } }>(
      '/reports/missing-business-dates',
    ).then(setMissing);
  }, []);

  useEffect(() => {
    if (tab === 'purchases') {
      void api<{ rows: PurchaseReportRow[] }>(`/reports/purchases${query}`).then((data) => setPurchaseRows(data.rows));
    } else if (tab === 'receipts') {
      void api<{ rows: ReceiptReportRow[] }>(`/reports/receipts${query}`).then((data) => setReceiptRows(data.rows));
    } else {
      void api<{ rows: MovementReportRow[] }>(`/reports/inventory-movements${query}`).then((data) =>
        setMovementRows(data.rows),
      );
    }
  }, [tab, query]);

  return (
    <div className="space-y-4">
      <PageHeader title="Отчёты" subtitle="Фильтрация по фактическим бизнес-датам" />

      {missing && (missing.summary.purchasesWithoutDate > 0 || missing.summary.movementsWithoutTransactionDate > 0) ? (
        <Card className="border-amber-200 bg-amber-50 text-sm">
          <p className="font-semibold">Требуется указать исторические даты</p>
          <p className="mt-1 text-muted">
            Закупок без даты закупки: {missing.summary.purchasesWithoutDate}. Движений без transactionDate:{' '}
            {missing.summary.movementsWithoutTransactionDate}.
          </p>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['purchases', 'Закупки'],
            ['receipts', 'Приходы'],
            ['movements', 'Движения'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${
              tab === key ? 'bg-brand text-white' : 'border border-line bg-white'
            }`}
          >
            {label}
          </button>
        ))}
        <button
          onClick={() => {
            setPreset('custom');
            setRange(monthInputRange(2026, 3));
            setTab('purchases');
          }}
          className="min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-semibold"
        >
          Март 2026
        </button>
      </div>

      <DateRangeFilter
        preset={preset}
        from={from}
        to={to}
        onPresetChange={setPreset}
        onFromChange={(value) => setRange((s) => ({ ...s, from: value }))}
        onToChange={(value) => setRange((s) => ({ ...s, to: value }))}
      />

      {tab === 'purchases' ? (
        <div className="space-y-3">
          {purchaseRows.length === 0 ? (
            <Card><p className="text-sm text-muted">Нет закупок за выбранный период</p></Card>
          ) : (
            purchaseRows.map((row) => (
              <Card key={row.number}>
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <p className="font-semibold">{row.number}</p>
                    <p className="text-sm text-muted">{row.supplierName}</p>
                  </div>
                  <p className="text-sm">{formatBusinessDate(row.purchaseDate)}</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div><p className="text-muted">Кол-во</p><p>{qty(row.totalQuantity)}</p></div>
                  <div><p className="text-muted">CNY</p><p>{money(row.totalPurchaseCny, 'CNY')}</p></div>
                  <div><p className="text-muted">Транспорт</p><p>{money(row.totalLogisticsKgs, 'KGS')}</p></div>
                  <div><p className="text-muted">Себестоимость</p><p>{money(row.estimatedTotalLandedCostKgs, 'KGS')}</p></div>
                </div>
              </Card>
            ))
          )}
        </div>
      ) : null}

      {tab === 'receipts' ? (
        <div className="space-y-3">
          {receiptRows.length === 0 ? (
            <Card><p className="text-sm text-muted">Нет приходов за выбранный период</p></Card>
          ) : (
            receiptRows.map((row) => (
              <Card key={row.number}>
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <p className="font-semibold">{row.number}</p>
                    <p className="text-sm text-muted">{row.purchaseNumber} · {row.supplierName}</p>
                  </div>
                  <p className="text-sm">{formatBusinessDate(row.warehouseReceiptDate)}</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div><p className="text-muted">Заказано</p><p>{qty(row.totalOrderedQuantity)}</p></div>
                  <div><p className="text-muted">Получено</p><p>{qty(row.totalReceivedQuantity)}</p></div>
                  <div><p className="text-muted">Недостача</p><p>{qty(row.totalShortage)}</p></div>
                  <div><p className="text-muted">Себестоимость</p><p>{money(row.totalLandedCostKgs, 'KGS')}</p></div>
                </div>
              </Card>
            ))
          )}
        </div>
      ) : null}

      {tab === 'movements' ? (
        <div className="space-y-3">
          {movementRows.length === 0 ? (
            <Card><p className="text-sm text-muted">Нет движений за выбранный период</p></Card>
          ) : (
            movementRows.map((row) => (
              <Card key={`${row.referenceId}-${row.productCode}-${row.transactionDate}`}>
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <p className="font-semibold">{row.productName}</p>
                    <p className="text-sm text-muted">{row.typeLabel}</p>
                  </div>
                  <p className="text-sm">{formatBusinessDate(row.transactionDate)}</p>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div><p className="text-muted">Кол-во</p><p>+{qty(row.quantity)}</p></div>
                  <div><p className="text-muted">Себестоимость</p><p>{money(row.unitCost, 'KGS')}</p></div>
                  <div><p className="text-muted">Сумма</p><p>{money(row.totalCost, 'KGS')}</p></div>
                  <div><p className="text-muted">Остаток</p><p>{qty(row.balanceAfter)}</p></div>
                </div>
              </Card>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
