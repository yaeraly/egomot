'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Category } from '@/lib/types';
import { Button, ErrorText, Field, Input } from '@/components/ui';

export function CategoryForm({ category }: { category?: Category }) {
  const router = useRouter();
  const [name, setName] = useState(category?.name ?? '');
  const [isActive, setIsActive] = useState(category?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = { name: name.trim(), isActive };
      const saved = category
        ? await api<Category>(`/categories/${category.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api<Category>('/categories', { method: 'POST', body: JSON.stringify(payload) });
      router.push(`/categories/${saved.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить категорию');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Название">
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <label className="flex min-h-12 items-center gap-2 text-sm">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-5 w-5" />
        Активна
      </label>
      <ErrorText error={error} />
      <Button type="submit" disabled={busy} className="w-full">
        {busy ? 'Сохранение…' : 'Сохранить'}
      </Button>
    </form>
  );
}
