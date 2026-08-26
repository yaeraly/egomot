'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { PaymentMethod } from '@/lib/types';
import { Button, ErrorText, Field, Input } from '@/components/ui';

export function PaymentMethodForm({ method }: { method?: PaymentMethod }) {
  const router = useRouter();
  const [code, setCode] = useState(method?.code ?? '');
  const [name, setName] = useState(method?.name ?? '');
  const [sortOrder, setSortOrder] = useState(String(method?.sortOrder ?? ''));
  const [isActive, setIsActive] = useState(method?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = method
        ? {
            name,
            ...(sortOrder ? { sortOrder: Number(sortOrder) } : {}),
            isActive,
          }
        : {
            code: code.trim().toUpperCase(),
            name: name.trim(),
            ...(sortOrder ? { sortOrder: Number(sortOrder) } : {}),
            isActive,
          };

      const saved = method
        ? await api<PaymentMethod>(`/finance/accounts/${method.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await api<PaymentMethod>('/finance/accounts', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

      router.push(`/finance/accounts/${saved.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить счёт');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {!method ? (
        <Field label="Код" hint="Например: CASH, MBANK, ODENGI">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            required
            pattern="[A-Z0-9_]+"
          />
        </Field>
      ) : (
        <Field label="Код">
          <Input value={method.code} disabled />
        </Field>
      )}
      <Field label="Название">
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Порядок сортировки" hint="Меньше — выше в списке POS">
        <Input
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          inputMode="numeric"
        />
      </Field>
      <label className="flex min-h-12 items-center gap-2 text-sm">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="h-5 w-5" />
        Активен (доступен в POS)
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
