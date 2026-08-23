'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { defaultCustomRange, DateRangeFilter } from '@/components/DateRangeFilter';
import { Card, EmptyState, PageHeader, SearchBox } from '@/components/ui';
import { money, qty } from '@/lib/format';
import { DatePresetValue } from '@/lib/date';

type ReconciliationStatus =
  | 'OK'
  | 'NEGATIVE_STOCK'
  | 'STOCK_MISMATCH'
  | 'MISSING_PURCHASE_HISTORY'
  | 'MISSING_OPENING_STOCK';

interface ReconciliationProduct {
  productId: string;
  productName: string;
  productCode: string;
  categoryName: string;
  purchasedQty: string;
  soldQty: string;
  calculatedStock: string;
  currentStock: string;
  difference: string;
  purchaseAmountKgs: string;
  salesAmountKgs: string;
  status: ReconciliationStatus;
  firstNegativeDate: string | null;
  negativeQty: string;
  requiredPurchaseQty: string;
  possibleCause: string | null;
}

interface ReconciliationReport {
  summary: {
    totalProducts: number;
    totalPurchasedQty: string;
    totalSoldQty: string;
    totalCurrentStock: string;
    negativeStockProducts: number;
    stockMismatches: number;
    missingPurchaseHistory: number;
    totalPurchaseAmountKgs: string;
    totalSalesAmountKgs: string;
  };
  products: ReconciliationProduct[];
  note?: string;
}

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'ALL', label: 'Все' },
  { value: 'OK', label: 'OK' },
  { value: 'NEGATIVE_STOCK', label: 'Отрицательный остаток' },
  { value: 'STOCK_MISMATCH', label: 'Расхождение' },
  { value: 'MISSING_PURCHASE_HISTORY', label: 'Нет истории закупок' },
  { value: 'MISSING_OPENING_STOCK', label: 'Нет начального остатка' },
];

const STATUS_LABELS: Record<ReconciliationStatus, string> = {
  OK: 'OK',
  NEGATIVE_STOCK: 'Отриц. остаток',
  STOCK_MISMATCH: 'Расхождение',
  MISSING_PURCHASE_HISTORY: 'Нет закупок',
  MISSING_OPENING_STOCK: 'Нет нач. остатка',
};

function statusClass(status: ReconciliationStatus): string {
  switch (status) {
    case 'OK':
      return 'bg-emerald-100 text-emerald-800';
    case 'STOCK_MISMATCH':
      return 'bg-amber-100 text-amber-900';
    case 'MISSING_PURCHASE_HISTORY':
    case 'MISSING_OPENING_STOCK':
    case 'NEGATIVE_STOCK':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-slate-100 text-slate-800';
  }
}

function exportCsv(products: ReconciliationProduct[]) {
  const headers = [
    'Product',
    'Category',
    'Purchased Qty',
    'Sold Qty',
    'Calculated Stock',
    'Current Stock',
    'Difference',
    'Purchase Amount',
    'Sales Amount',
    'Status',
    'First Negative Date',
    'Required Purchase Qty',
    'Possible Cause',
  ];
  const rows = products.map((row) => [
    row.productName,
    row.categoryName,
    row.purchasedQty,
    row.soldQty,
    row.calculatedStock,
    row.currentStock,
    row.difference,
    row.purchaseAmountKgs,
    row.salesAmountKgs,
    row.status,
    row.firstNegativeDate ?? '',
    row.requiredPurchaseQty,
    row.possibleCause ?? '',
  ]);
  const csv = [headers, ...rows]
    .map((line) =>
      line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','),
    )
    .join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'inventory-reconciliation.csv';
  link.click();
  URL.revokeObjectURL(url);
}

export default function WarehouseReconciliationPage() {
  const [preset, setPreset] = useState<DatePresetValue | 'all'>('all');
  const [{ from, to }, setRange] = useState(defaultCustomRange);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [loading, setLoading] = useState(true);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (preset !== 'all') {
      if (preset === 'custom') {
        if (from) params.set('from', from);
        if (to) params.set('to', to);
      } else {
        params.set('preset', preset);
      }
    }
    if (status !== 'ALL') params.set('status', status);
    if (search.trim()) params.set('search', search.trim());
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [preset, from, to, status, search]);

  useEffect(() => {
    setLoading(true);
    void api<ReconciliationReport>(`/reports/inventory-reconciliation${query}`)
      .then(setReport)
      .finally(() => setLoading(false));
  }, [query]);

  const negativeProducts = useMemo(
    () =>
      (report?.products ?? []).filter(
        (row) => Number(row.calculatedStock) < 0,
      ),
    [report],
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Сверка склада"
        subtitle="Sales vs Purchases vs Stock — диагностика отрицательных остатков"
      />

      {report?.note ? (
        <Card className="border-slate-200 bg-slate-50 text-sm text-muted">
          {report.note}
        </Card>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[200px]">
          <label className="mb-1 block text-xs font-medium text-muted">Период</label>
          <select
            className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm"
            value={preset}
            onChange={(e) => setPreset(e.target.value as DatePresetValue | 'all')}
          >
            <option value="all">Вся история</option>
            <option value="month">Месяц</option>
            <option value="quarter">Квартал</option>
            <option value="year">Год</option>
            <option value="custom">Произвольный</option>
          </select>
        </div>
        {preset === 'custom' ? (
          <DateRangeFilter
            preset="custom"
            from={from}
            to={to}
            onPresetChange={() => undefined}
            onFromChange={(value) => setRange({ from: value, to })}
            onToChange={(value) => setRange({ from, to: value })}
          />
        ) : null}
        <div className="min-w-[200px]">
          <label className="mb-1 block text-xs font-medium text-muted">Статус</label>
          <select
            className="min-h-11 w-full rounded-xl border border-line bg-white px-3 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <SearchBox
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Товар или код"
          className="min-w-[220px] flex-1"
        />
        <button
          type="button"
          disabled={!report?.products.length}
          onClick={() => report && exportCsv(report.products)}
          className="min-h-11 rounded-xl border border-line bg-white px-4 text-sm font-semibold disabled:opacity-50"
        >
          Экспорт CSV
        </button>
      </div>

      {loading ? (
        <Card className="text-sm text-muted">Загрузка…</Card>
      ) : report ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            <SummaryCard label="Товаров" value={String(report.summary.totalProducts)} />
            <SummaryCard label="Закуплено" value={qty(report.summary.totalPurchasedQty)} />
            <SummaryCard label="Продано" value={qty(report.summary.totalSoldQty)} />
            <SummaryCard label="Текущий остаток" value={qty(report.summary.totalCurrentStock)} />
            <SummaryCard
              label="Отриц. остатки"
              value={String(report.summary.negativeStockProducts)}
              warn={report.summary.negativeStockProducts > 0}
            />
            <SummaryCard
              label="Расхождения"
              value={String(report.summary.stockMismatches)}
              warn={report.summary.stockMismatches > 0}
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card>
              <p className="text-sm text-muted">Сумма продаж</p>
              <p className="mt-1 text-2xl font-bold">
                {money(report.summary.totalSalesAmountKgs, 'сом')}
              </p>
            </Card>
            <Card>
              <p className="text-sm text-muted">Сумма закупок</p>
              <p className="mt-1 text-2xl font-bold">
                {money(report.summary.totalPurchaseAmountKgs, 'сом')}
              </p>
            </Card>
          </div>

          <Card>
            <h2 className="mb-3 text-lg font-semibold">Sales vs Purchases vs Stock</h2>
            {report.products.length === 0 ? (
              <EmptyState title="Нет данных" text="Измените фильтры" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-muted">
                      <th className="py-2 pr-3">Товар</th>
                      <th className="py-2 pr-3">Закуплено</th>
                      <th className="py-2 pr-3">Продано</th>
                      <th className="py-2 pr-3">Расч. остаток</th>
                      <th className="py-2 pr-3">Система</th>
                      <th className="py-2 pr-3">Разница</th>
                      <th className="py-2 pr-3">Закупка</th>
                      <th className="py-2 pr-3">Продажа</th>
                      <th className="py-2">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.products.map((row) => (
                      <tr key={row.productId} className="border-b border-line/60">
                        <td className="py-2 pr-3">
                          <p className="font-medium">{row.productName}</p>
                          <p className="text-xs text-muted">{row.productCode}</p>
                        </td>
                        <td className="py-2 pr-3">{qty(row.purchasedQty)}</td>
                        <td className="py-2 pr-3">{qty(row.soldQty)}</td>
                        <td
                          className={`py-2 pr-3 font-medium ${
                            Number(row.calculatedStock) < 0 ? 'text-red-700' : ''
                          }`}
                        >
                          {qty(row.calculatedStock)}
                        </td>
                        <td className="py-2 pr-3">{qty(row.currentStock)}</td>
                        <td className="py-2 pr-3">{qty(row.difference)}</td>
                        <td className="py-2 pr-3">{money(row.purchaseAmountKgs, 'сом')}</td>
                        <td className="py-2 pr-3">{money(row.salesAmountKgs, 'сом')}</td>
                        <td className="py-2">
                          <span
                            className={`inline-block rounded-lg px-2 py-0.5 text-xs font-semibold ${statusClass(row.status)}`}
                          >
                            {STATUS_LABELS[row.status]}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-semibold">Отрицательные остатки</h2>
            {negativeProducts.length === 0 ? (
              <EmptyState title="Нет отрицательных остатков" text="Все товары сходятся или в плюсе" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[800px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-muted">
                      <th className="py-2 pr-3">Товар</th>
                      <th className="py-2 pr-3">Закуплено</th>
                      <th className="py-2 pr-3">Продано</th>
                      <th className="py-2 pr-3">Отриц. qty</th>
                      <th className="py-2 pr-3">Первая дата</th>
                      <th className="py-2">Причина</th>
                    </tr>
                  </thead>
                  <tbody>
                    {negativeProducts.map((row) => (
                      <tr key={row.productId} className="border-b border-line/60">
                        <td className="py-2 pr-3 font-medium">{row.productName}</td>
                        <td className="py-2 pr-3">{qty(row.purchasedQty)}</td>
                        <td className="py-2 pr-3">{qty(row.soldQty)}</td>
                        <td className="py-2 pr-3 font-medium text-red-700">
                          {qty(row.negativeQty)}
                          {Number(row.requiredPurchaseQty) > 0 ? (
                            <span className="block text-xs text-muted">
                              не хватает закупок: {qty(row.requiredPurchaseQty)}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3">{row.firstNegativeDate ?? '—'}</td>
                        <td className="py-2 text-muted">{row.possibleCause ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <Card className={warn ? 'border-red-200 bg-red-50' : undefined}>
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${warn ? 'text-red-800' : ''}`}>{value}</p>
    </Card>
  );
}
