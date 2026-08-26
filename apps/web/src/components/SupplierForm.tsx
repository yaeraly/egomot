'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Supplier } from '@/lib/types';
import { Button, ErrorText, Field, Input, Textarea } from '@/components/ui';

export function SupplierForm({ supplier }: { supplier?: Supplier }) {
  const router = useRouter();
  const [name, setName] = useState(supplier?.name ?? '');
  const [companyName, setCompanyName] = useState(supplier?.companyName ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [wechat, setWechat] = useState(supplier?.wechat ?? '');
  const [address, setAddress] = useState(supplier?.address ?? '');
  const [city, setCity] = useState(supplier?.city ?? '');
  const [notes, setNotes] = useState(supplier?.notes ?? '');
  const [isActive, setIsActive] = useState(supplier?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = {
        name,
        companyName: companyName || null,
        phone,
        wechat: wechat || null,
        address: address || null,
        city: city || null,
        notes: notes || null,
        isActive,
      };
      const saved = supplier
        ? await api<Supplier>(`/suppliers/${supplier.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api<Supplier>('/suppliers', { method: 'POST', body: JSON.stringify(payload) });
      router.push(`/suppliers/${saved.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить поставщика');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Имя">
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Компания" hint="Необязательно">
        <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
      </Field>
      <Field label="Телефон">
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} required inputMode="tel" />
      </Field>
      <Field label="WeChat" hint="Необязательно">
        <Input value={wechat} onChange={(e) => setWechat(e.target.value)} />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Город">
          <Input value={city} onChange={(e) => setCity(e.target.value)} />
        </Field>
        <Field label="Адрес">
          <Input value={address} onChange={(e) => setAddress(e.target.value)} />
        </Field>
      </div>
      <Field label="Заметки">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
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
