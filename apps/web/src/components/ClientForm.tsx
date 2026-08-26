'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Client, CLIENT_TYPE_LABELS, ClientType } from '@/lib/types';
import { Button, ErrorText, Field, Input, Select, Textarea } from '@/components/ui';

const CLIENT_TYPES: ClientType[] = ['RETAIL', 'MASTER', 'WHOLESALE'];

export function ClientForm({ client }: { client?: Client }) {
  const router = useRouter();
  const [name, setName] = useState(client?.name ?? '');
  const [companyName, setCompanyName] = useState(client?.companyName ?? '');
  const [phone, setPhone] = useState(client?.phone ?? '');
  const [email, setEmail] = useState(client?.email ?? '');
  const [address, setAddress] = useState(client?.address ?? '');
  const [city, setCity] = useState(client?.city ?? '');
  const [notes, setNotes] = useState(client?.notes ?? '');
  const [clientType, setClientType] = useState<ClientType>(client?.clientType ?? 'RETAIL');
  const [isActive, setIsActive] = useState(client?.isActive ?? true);
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
        email: email || null,
        address: address || null,
        city: city || null,
        notes: notes || null,
        clientType,
        isActive,
      };
      const saved = client
        ? await api<Client>(`/clients/${client.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api<Client>('/clients', { method: 'POST', body: JSON.stringify(payload) });
      router.push(`/clients/${saved.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить клиента');
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
      <Field label="Email" hint="Необязательно">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      <Field label="Тип клиента" hint="Категория определяется автоматически по покупкам за 90 дней">
        <Select value={clientType} onChange={(e) => setClientType(e.target.value as ClientType)}>
          {CLIENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {CLIENT_TYPE_LABELS[type]}
            </option>
          ))}
        </Select>
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
