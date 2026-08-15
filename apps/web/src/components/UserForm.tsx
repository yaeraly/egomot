'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { ManagedUser, UserRole } from '@/lib/types';
import { Button, ErrorText, Field, Input } from '@/components/ui';

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: 'SALES', label: 'Master (продажи)' },
  { value: 'WAREHOUSE', label: 'Склад' },
];

export function UserForm({ user }: { user?: ManagedUser }) {
  const router = useRouter();
  const [email, setEmail] = useState(user?.email ?? '');
  const [name, setName] = useState(user?.name ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>(user?.role === 'OWNER' ? 'SALES' : (user?.role ?? 'SALES'));
  const [isActive, setIsActive] = useState(user?.isActive ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const payload = user
        ? {
            email: email.trim(),
            name: name.trim(),
            ...(password ? { password } : {}),
            ...(user.role !== 'OWNER' ? { role } : {}),
            isActive,
          }
        : {
            email: email.trim(),
            name: name.trim(),
            password,
            role,
            isActive,
          };

      const saved = user
        ? await api<ManagedUser>(`/users/${user.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : await api<ManagedUser>('/users', {
            method: 'POST',
            body: JSON.stringify(payload),
          });

      router.push(`/settings/users/${saved.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить пользователя');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Email">
        <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="Имя">
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label={user ? 'Новый пароль' : 'Пароль'} hint={user ? 'Оставьте пустым, если не меняете' : undefined}>
        <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required={!user} minLength={6} />
      </Field>
      {user?.role === 'OWNER' ? (
        <Field label="Роль">
          <Input value="OWNER" disabled />
        </Field>
      ) : (
        <Field label="Роль">
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="min-h-12 w-full rounded-xl border border-line bg-white px-3"
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      )}
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
