'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { Category } from '@/lib/types';
import { Field, Input } from './ui';

export function CategorySelect({
  value,
  onChange,
  required = true,
}: {
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
}) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [query, setQuery] = useState('');

  useEffect(() => {
    void api<Category[]>('/categories?active=true').then(setCategories);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(q));
  }, [categories, query]);

  return (
    <div className="space-y-2">
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск категории"
      />
      <Field label="Категория">
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          className="min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base"
        >
          <option value="">Выберите категорию</option>
          {filtered.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
