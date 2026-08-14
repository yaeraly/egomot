'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import {
  Currency,
  LogisticsType,
  LOGISTICS_LABELS,
  Product,
  Purchase,
  PurchasePreview,
  Supplier,
} from '@/lib/types';
import { Button, Card, ErrorText, Field, Input, Select, Textarea } from './ui';
import { PurchaseSummary } from './PurchaseSummary';

const STEPS = [
  'Поставщик',
  'Товары',
  'Кол-во и цены',
  'Курс',
  'Логистика',
  'Расчёт',
  'Сохранение',
];

type Line = {
  productId: string;
  name: string;
  code: string;
  unit: string;
  quantity: string;
  unitPriceCny: string;
  unitWeightKg: string;
};

type LogLine = {
  key: string;
  type: LogisticsType;
  amount: string;
  currency: Currency;
  exchangeRate: string;
  comment: string;
};

export function PurchaseWizard({ purchase }: { purchase?: Purchase }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productQuery, setProductQuery] = useState('');
  const [supplierId, setSupplierId] = useState(purchase?.supplierId ?? '');
  const [items, setItems] = useState<Line[]>(
    purchase?.items?.map((i) => ({
      productId: i.productId,
      name: i.product?.name ?? '',
      code: i.product?.code ?? '',
      unit: i.product?.unit ?? '',
      quantity: i.quantity,
      unitPriceCny: i.unitPriceCny,
      unitWeightKg: i.unitWeightKg,
    })) ?? [],
  );
  const [exchangeRateCnyToKgs, setExchangeRateCnyToKgs] = useState(
    purchase?.exchangeRateCnyToKgs ?? '',
  );
  const [logistics, setLogistics] = useState<LogLine[]>(
    purchase?.logistics?.map((row, index) => ({
      key: row.id || String(index),
      type: row.type,
      amount: row.amount,
      currency: row.currency,
      exchangeRate: row.exchangeRate ?? '',
      comment: row.comment ?? '',
    })) ?? [],
  );
  const [notes, setNotes] = useState(purchase?.notes ?? '');
  const [preview, setPreview] = useState<PurchasePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<Supplier[]>('/suppliers?active=true').then(setSuppliers);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      const q = productQuery ? `?search=${encodeURIComponent(productQuery)}&active=true` : '?active=true';
      void api<Product[]>(`/products${q}`).then(setProducts);
    }, 200);
    return () => clearTimeout(t);
  }, [productQuery]);

  const payload = useMemo(
    () => ({
      supplierId,
      exchangeRateCnyToKgs,
      notes: notes || null,
      items: items.map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPriceCny: i.unitPriceCny,
        unitWeightKg: i.unitWeightKg,
      })),
      logistics: logistics.map((row) => ({
        type: row.type,
        amount: row.amount || '0',
        currency: row.currency,
        exchangeRate: row.currency === 'KGS' ? null : row.exchangeRate,
        comment: row.comment || null,
      })),
    }),
    [supplierId, exchangeRateCnyToKgs, notes, items, logistics],
  );

  useEffect(() => {
    if (step < 5) return;
    if (!supplierId || items.length === 0 || !exchangeRateCnyToKgs) return;
    const t = setTimeout(() => {
      void api<PurchasePreview>('/purchases/preview', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
        .then((data) => {
          setPreview(data);
          setError(null);
        })
        .catch((err) => {
          setPreview(null);
          setError(err instanceof ApiError ? err.message : 'Ошибка расчёта');
        });
    }, 250);
    return () => clearTimeout(t);
  }, [payload, step, supplierId, items.length, exchangeRateCnyToKgs]);

  function canNext() {
    if (step === 0) return Boolean(supplierId);
    if (step === 1) return items.length > 0;
    if (step === 2) {
      return items.every(
        (i) => Number(i.quantity) > 0 && Number(i.unitPriceCny) >= 0 && Number(i.unitWeightKg) > 0,
      );
    }
    if (step === 3) return Number(exchangeRateCnyToKgs) > 0;
    if (step === 4) {
      return logistics.every((row) => {
        if (Number(row.amount) < 0) return false;
        if (row.currency !== 'KGS' && Number(row.exchangeRate) <= 0) return false;
        return true;
      });
    }
    if (step === 5) return Boolean(preview);
    return true;
  }

  function addProduct(p: Product) {
    if (items.some((i) => i.productId === p.id)) return;
    setItems((prev) => [
      ...prev,
      {
        productId: p.id,
        name: p.name,
        code: p.code,
        unit: p.unit,
        quantity: '1',
        unitPriceCny: p.defaultPurchasePriceCny ?? '',
        unitWeightKg: p.unitWeightKg,
      },
    ]);
  }

  async function save(markOrdered: boolean) {
    setBusy(true);
    setError(null);
    try {
      const saved = purchase
        ? await api<Purchase>(`/purchases/${purchase.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await api<Purchase>('/purchases', { method: 'POST', body: JSON.stringify(payload) });
      if (markOrdered && saved.status === 'DRAFT') {
        await api(`/purchases/${saved.id}/status`, {
          method: 'PATCH',
          body: JSON.stringify({ status: 'ORDERED' }),
        });
      }
      router.push(`/purchases/${saved.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить закупку');
    } finally {
      setBusy(false);
    }
  }

  const supplierName = suppliers.find((s) => s.id === supplierId)?.name || purchase?.supplier?.name;

  return (
    <div>
      <div className="mb-4 overflow-x-auto">
        <div className="flex min-w-max gap-1">
          {STEPS.map((label, i) => (
            <button
              key={label}
              type="button"
              onClick={() => i <= step && setStep(i)}
              className={`rounded-full px-3 py-2 text-xs font-semibold ${
                i === step ? 'bg-brand text-white' : i < step ? 'bg-brand-soft text-brand-dark' : 'bg-slate-100 text-muted'
              }`}
            >
              {i + 1}. {label}
            </button>
          ))}
        </div>
      </div>

      {step === 0 && (
        <div className="space-y-3">
          <p className="font-semibold">Выберите поставщика</p>
          {suppliers.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSupplierId(s.id)}
              className={`w-full rounded-2xl border p-4 text-left ${
                supplierId === s.id ? 'border-brand bg-brand-soft' : 'border-line bg-white'
              }`}
            >
              <p className="font-semibold">{s.name}</p>
              <p className="text-sm text-muted">{s.companyName || s.phone}</p>
            </button>
          ))}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-3">
          <Field label="Найти товар">
            <Input value={productQuery} onChange={(e) => setProductQuery(e.target.value)} placeholder="Название или код" />
          </Field>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {products.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => addProduct(p)}
                className="flex w-full items-center justify-between rounded-xl border border-line bg-white p-3 text-left"
              >
                <span>
                  <span className="font-medium">{p.name}</span>
                  <span className="ml-2 text-xs text-muted">{p.code}</span>
                </span>
                <span className="text-sm text-brand">Добавить</span>
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {items.map((i) => (
              <Card key={i.productId} className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-medium">{i.name}</span>
                  <span className="ml-2 text-xs text-muted">{i.code}</span>
                </span>
                <button
                  type="button"
                  className="text-sm text-danger"
                  onClick={() => setItems((prev) => prev.filter((x) => x.productId !== i.productId))}
                >
                  Убрать
                </button>
              </Card>
            ))}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.productId} className="space-y-3">
              <p className="font-semibold">
                {item.name} <span className="text-sm font-normal text-muted">{item.code}</span>
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Field label={`Количество, ${item.unit}`}>
                  <Input
                    inputMode="decimal"
                    value={item.quantity}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((x) => (x.productId === item.productId ? { ...x, quantity: e.target.value } : x)),
                      )
                    }
                  />
                </Field>
                <Field label="Цена, CNY">
                  <Input
                    inputMode="decimal"
                    value={item.unitPriceCny}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((x) => (x.productId === item.productId ? { ...x, unitPriceCny: e.target.value } : x)),
                      )
                    }
                  />
                </Field>
                <Field label="Вес ед., кг">
                  <Input
                    inputMode="decimal"
                    value={item.unitWeightKg}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((x) => (x.productId === item.productId ? { ...x, unitWeightKg: e.target.value } : x)),
                      )
                    }
                  />
                </Field>
              </div>
            </Card>
          ))}
        </div>
      )}

      {step === 3 && (
        <Field label="Курс CNY → KGS" hint="Используется для расчёта себестоимости закупки в сомах">
          <Input
            inputMode="decimal"
            value={exchangeRateCnyToKgs}
            onChange={(e) => setExchangeRateCnyToKgs(e.target.value)}
            placeholder="например 12.35"
          />
        </Field>
      )}

      {step === 4 && (
        <div className="space-y-3">
          {logistics.map((row) => (
            <Card key={row.key} className="space-y-3">
              <Field label="Тип">
                <Select
                  value={row.type}
                  onChange={(e) =>
                    setLogistics((prev) =>
                      prev.map((x) => (x.key === row.key ? { ...x, type: e.target.value as LogisticsType } : x)),
                    )
                  }
                >
                  {(Object.keys(LOGISTICS_LABELS) as LogisticsType[]).map((type) => (
                    <option key={type} value={type}>
                      {LOGISTICS_LABELS[type]}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Сумма">
                  <Input
                    inputMode="decimal"
                    value={row.amount}
                    onChange={(e) =>
                      setLogistics((prev) => prev.map((x) => (x.key === row.key ? { ...x, amount: e.target.value } : x)))
                    }
                  />
                </Field>
                <Field label="Валюта">
                  <Select
                    value={row.currency}
                    onChange={(e) =>
                      setLogistics((prev) =>
                        prev.map((x) => (x.key === row.key ? { ...x, currency: e.target.value as Currency } : x)),
                      )
                    }
                  >
                    <option value="KGS">KGS</option>
                    <option value="CNY">CNY</option>
                    <option value="USD">USD</option>
                  </Select>
                </Field>
              </div>
              {row.currency !== 'KGS' ? (
                <Field label={`Курс ${row.currency} → KGS`}>
                  <Input
                    inputMode="decimal"
                    value={row.exchangeRate}
                    onChange={(e) =>
                      setLogistics((prev) =>
                        prev.map((x) => (x.key === row.key ? { ...x, exchangeRate: e.target.value } : x)),
                      )
                    }
                  />
                </Field>
              ) : null}
              <Field label="Комментарий">
                <Input
                  value={row.comment}
                  onChange={(e) =>
                    setLogistics((prev) => prev.map((x) => (x.key === row.key ? { ...x, comment: e.target.value } : x)))
                  }
                />
              </Field>
              <button
                type="button"
                className="text-sm text-danger"
                onClick={() => setLogistics((prev) => prev.filter((x) => x.key !== row.key))}
              >
                Удалить расход
              </button>
            </Card>
          ))}
          <Button
            type="button"
            variant="secondary"
            className="w-full"
            onClick={() =>
              setLogistics((prev) => [
                ...prev,
                {
                  key: crypto.randomUUID(),
                  type: 'CARGO',
                  amount: '',
                  currency: 'KGS',
                  exchangeRate: '',
                  comment: '',
                },
              ])
            }
          >
            + Расход логистики
          </Button>
        </div>
      )}

      {step === 5 && preview && (
        <PurchaseSummary
          supplierName={supplierName}
          totals={preview.totals}
          items={preview.items.map((item) => ({
            ...item,
            productName: items.find((i) => i.productId === item.productId)?.name,
          }))}
        />
      )}

      {step === 6 && (
        <div className="space-y-4">
          <Field label="Заметки">
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {preview ? (
            <p className="text-sm text-muted">
              Ориентировочная себестоимость: {preview.totals.estimatedTotalLandedCostKgs} KGS. Расчёты выполняет
              сервер при сохранении.
            </p>
          ) : null}
          {purchase && purchase.status !== 'DRAFT' ? (
            <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              Закупка уже не черновик. Изменение количества, цен, курса, веса и логистики будет записано в журнал аудита.
            </p>
          ) : null}
        </div>
      )}

      <ErrorText error={error} />

      <div className="sticky bottom-3 z-10 mt-6 flex gap-2">
        {step > 0 ? (
          <Button type="button" variant="secondary" className="flex-1" onClick={() => setStep((s) => s - 1)}>
            Назад
          </Button>
        ) : null}
        {step < 6 ? (
          <Button type="button" className="flex-1" disabled={!canNext()} onClick={() => setStep((s) => s + 1)}>
            Далее
          </Button>
        ) : (
          <>
            <Button type="button" variant="secondary" className="flex-1" disabled={busy} onClick={() => void save(false)}>
              Сохранить
            </Button>
            <Button type="button" className="flex-1" disabled={busy} onClick={() => void save(true)}>
              Заказать
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
