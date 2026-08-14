'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Product, ProductCategory, UNITS } from '@/lib/types';
import { Button, ErrorText, Field, Input, Select } from '@/components/ui';

export function ProductForm({ product }: { product?: Product }) {
  const router = useRouter();
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [name, setName] = useState(product?.name ?? '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? '');
  const [newCategory, setNewCategory] = useState('');
  const [unit, setUnit] = useState(product?.unit ?? 'шт');
  const [unitWeightKg, setUnitWeightKg] = useState(product?.unitWeightKg ?? '');
  const [defaultPurchasePriceCny, setDefaultPurchasePriceCny] = useState(
    product?.defaultPurchasePriceCny ?? '',
  );
  const [isActive, setIsActive] = useState(product?.isActive ?? true);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<ProductCategory[]>('/product-categories').then((rows) => {
      setCategories(rows);
      if (!product && rows[0]) setCategoryId(rows[0].id);
    });
  }, [product]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let catId = categoryId;
      if (newCategory.trim()) {
        const cat = await api<ProductCategory>('/product-categories', {
          method: 'POST',
          body: JSON.stringify({ name: newCategory.trim() }),
        });
        catId = cat.id;
      }
      const payload = {
        name,
        categoryId: catId,
        unit,
        unitWeightKg,
        defaultPurchasePriceCny: defaultPurchasePriceCny || null,
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
      <Field label="Категория">
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required={!newCategory}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Новая категория" hint="Если заполнить, будет создана новая категория">
        <Input value={newCategory} onChange={(e) => setNewCategory(e.target.value)} />
      </Field>
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
      <Field label="Цена закупки по умолчанию, CNY" hint="Необязательно">
        <Input inputMode="decimal" value={defaultPurchasePriceCny} onChange={(e) => setDefaultPurchasePriceCny(e.target.value)} />
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
