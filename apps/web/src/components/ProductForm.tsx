'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Product, UNITS } from '@/lib/types';
import { Button, ErrorText, Field, Input, Select } from '@/components/ui';
import { CategorySelect } from '@/components/CategorySelect';

export function ProductForm({ product }: { product?: Product }) {
  const router = useRouter();
  const [name, setName] = useState(product?.name ?? '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '');
  const [unit, setUnit] = useState(product?.unit ?? 'шт');
  const [unitWeightKg, setUnitWeightKg] = useState(product?.unitWeightKg ?? '');
  const [defaultPurchasePriceCny, setDefaultPurchasePriceCny] = useState(
    product?.defaultPurchasePriceCny ?? '',
  );
  const [baseMarkupPercent, setBaseMarkupPercent] = useState(product?.baseMarkupPercent ?? '');
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!product) return;
    setName(product.name);
    setCategoryId(product.categoryId);
    setUnit(product.unit);
    setUnitWeightKg(product.unitWeightKg);
    setDefaultPurchasePriceCny(product.defaultPurchasePriceCny ?? '');
    setBaseMarkupPercent(product.baseMarkupPercent ?? '');
    setIsActive(product.isActive);
  }, [product]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!categoryId) {
      setError('Выберите категорию');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name,
        categoryId,
        unit,
        unitWeightKg,
        defaultPurchasePriceCny: defaultPurchasePriceCny || null,
        baseMarkupPercent: baseMarkupPercent || null,
        isActive,
      };
      const saved = product
        ? await api<Product>(`/products/${product.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api<Product>('/products', { method: 'POST', body: JSON.stringify(payload) });
      if (file) {
        const form = new FormData();
        form.append('image', file);
        await api(`/products/${saved.id}/image`, { method: 'POST', body: form });
      }
      router.push(`/products/${saved.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить товар');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Название">
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <CategorySelect value={categoryId} onChange={setCategoryId} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Единица">
          <Select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {UNITS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </Select>
        </Field>
        <Field label="Вес единицы, кг">
          <Input inputMode="decimal" value={unitWeightKg} onChange={(e) => setUnitWeightKg(e.target.value)} required />
        </Field>
      </div>
      <Field label="Цена закупки, CNY">
        <Input inputMode="decimal" value={defaultPurchasePriceCny} onChange={(e) => setDefaultPurchasePriceCny(e.target.value)} />
      </Field>
      <Field label="Базовая наценка, %" hint="Наценка товара для расчёта цены продажи">
        <Input inputMode="decimal" value={baseMarkupPercent} onChange={(e) => setBaseMarkupPercent(e.target.value)} />
      </Field>
      <Field label="Фото" hint="Необязательно, JPG/PNG/WEBP до 5 МБ">
        <Input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      <label className="flex min-h-12 items-center gap-2 text-sm">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-5 w-5" />
        Активен
      </label>
      <ErrorText error={error} />
      <div className="sticky bottom-3">
        <Button type="submit" disabled={busy} className="w-full shadow-lg">
          {busy ? 'Сохранение…' : 'Сохранить'}
        </Button>
      </div>
    </form>
  );
}
