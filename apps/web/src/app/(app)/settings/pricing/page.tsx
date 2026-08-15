'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import {
  CLIENT_CATEGORY_LABELS,
  CLIENT_TYPE_LABELS,
  CategoryThreshold,
  ClientPricingCategory,
  ClientType,
  MarkupMatrixCell,
  PricingSettings,
} from '@/lib/types';
import { Button, Card, ErrorText, Input, PageHeader } from '@/components/ui';

const CLIENT_TYPES: ClientType[] = ['RETAIL', 'MASTER', 'WHOLESALE'];
const CATEGORIES: ClientPricingCategory[] = ['STANDARD', 'SILVER', 'GOLD', 'VIP'];

export default function PricingSettingsPage() {
  const [settings, setSettings] = useState<PricingSettings | null>(null);
  const [thresholds, setThresholds] = useState<CategoryThreshold[]>([]);
  const [matrix, setMatrix] = useState<MarkupMatrixCell[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<PricingSettings>('/pricing/settings').then((data) => {
      setSettings(data);
      setThresholds(data.thresholds);
      setMatrix(data.markupMatrix);
    });
  }, []);

  const matrixMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const cell of matrix) {
      map.set(`${cell.clientType}:${cell.category}`, cell.markupPercent);
    }
    return map;
  }, [matrix]);

  function updateThreshold(category: ClientPricingCategory, patch: Partial<CategoryThreshold>) {
    setThresholds((rows) =>
      rows.map((row) => (row.category === category ? { ...row, ...patch } : row)),
    );
  }

  function updateMatrix(clientType: ClientType, category: ClientPricingCategory, value: string) {
    setMatrix((rows) =>
      rows.map((row) =>
        row.clientType === clientType && row.category === category
          ? { ...row, markupPercent: value }
          : row,
      ),
    );
  }

  async function saveThresholds(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await api('/pricing/settings/thresholds', {
        method: 'PATCH',
        body: JSON.stringify({
          thresholds: thresholds.map((row) => ({
            category: row.category,
            minPaidAmountKgs: row.minPaidAmountKgs,
            maxPaidAmountKgs: row.maxPaidAmountKgs,
            priority: row.priority,
            isActive: row.isActive,
          })),
        }),
      });
      setOk('Пороги категорий сохранены');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить пороги');
    } finally {
      setBusy(false);
    }
  }

  async function saveMatrix(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await api('/pricing/settings/markup-matrix', {
        method: 'PATCH',
        body: JSON.stringify({
          items: matrix.map((row) => ({
            clientType: row.clientType,
            category: row.category,
            markupPercent: row.markupPercent,
          })),
        }),
      });
      setOk('Матрица наценок сохранена');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить матрицу');
    } finally {
      setBusy(false);
    }
  }

  if (!settings) return <p className="text-muted">Загрузка…</p>;

  return (
    <div>
      <PageHeader
        title="Ценообразование"
        subtitle="Пороги категорий и матрица наценок"
        action={
          <Link href="/settings" className="inline-flex min-h-12 items-center rounded-xl border border-line px-4 font-semibold">
            Профиль
          </Link>
        }
      />

      <Card className="mb-4">
        <form onSubmit={saveThresholds} className="space-y-4">
          <h2 className="font-semibold">Категории клиентов (90 дней, полностью оплаченные покупки)</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="py-2 pr-3">Категория</th>
                  <th className="py-2 pr-3">Мин. сумма, KGS</th>
                  <th className="py-2 pr-3">Макс. сумма, KGS</th>
                  <th className="py-2 pr-3">Приоритет</th>
                  <th className="py-2">Активна</th>
                </tr>
              </thead>
              <tbody>
                {thresholds.map((row) => (
                  <tr key={row.category} className="border-b border-line/60">
                    <td className="py-2 pr-3 font-medium">{CLIENT_CATEGORY_LABELS[row.category]}</td>
                    <td className="py-2 pr-3">
                      <Input
                        inputMode="decimal"
                        value={row.minPaidAmountKgs}
                        onChange={(e) => updateThreshold(row.category, { minPaidAmountKgs: e.target.value })}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        inputMode="decimal"
                        value={row.maxPaidAmountKgs ?? ''}
                        placeholder="—"
                        onChange={(e) =>
                          updateThreshold(row.category, {
                            maxPaidAmountKgs: e.target.value || null,
                          })
                        }
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <Input
                        inputMode="numeric"
                        value={String(row.priority)}
                        onChange={(e) =>
                          updateThreshold(row.category, { priority: Number(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td className="py-2">
                      <input
                        type="checkbox"
                        checked={row.isActive}
                        onChange={(e) => updateThreshold(row.category, { isActive: e.target.checked })}
                        className="h-5 w-5"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="submit" disabled={busy}>
            Сохранить пороги
          </Button>
        </form>
      </Card>

      <Card>
        <form onSubmit={saveMatrix} className="space-y-4">
          <h2 className="font-semibold">Матрица наценок: Тип × Категория (%)</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="py-2 pr-3">Тип</th>
                  {CATEGORIES.map((category) => (
                    <th key={category} className="py-2 pr-3">
                      {CLIENT_CATEGORY_LABELS[category]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {CLIENT_TYPES.map((clientType) => (
                  <tr key={clientType} className="border-b border-line/60">
                    <td className="py-2 pr-3 font-medium">{CLIENT_TYPE_LABELS[clientType]}</td>
                    {CATEGORIES.map((category) => (
                      <td key={category} className="py-2 pr-3">
                        <Input
                          inputMode="decimal"
                          value={matrixMap.get(`${clientType}:${category}`) ?? '0'}
                          onChange={(e) => updateMatrix(clientType, category, e.target.value)}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Button type="submit" disabled={busy}>
            Сохранить матрицу
          </Button>
        </form>
      </Card>

      <ErrorText error={error} />
      {ok ? <p className="mt-3 text-sm text-ok">{ok}</p> : null}
    </div>
  );
}
