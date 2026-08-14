'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AuthUser } from '@/lib/types';
import { useAuth } from '@/lib/auth';
import { Button, Card, ErrorText, Field, Input, PageHeader } from '@/components/ui';

export default function SettingsPage() {
  const { refresh } = useAuth();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [name, setName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<AuthUser>('/settings').then((u) => {
      setUser(u);
      setName(u.name);
    });
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const updated = await api<AuthUser>('/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          ...(newPassword ? { currentPassword, newPassword } : {}),
        }),
      });
      setUser(updated);
      setCurrentPassword('');
      setNewPassword('');
      setOk('Сохранено');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Настройки" subtitle="Профиль владельца" />
      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <p className="text-sm text-muted">{user?.email} · {user?.role}</p>
          <Field label="Имя">
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="Текущий пароль" hint="Нужен только при смене пароля">
            <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </Field>
          <Field label="Новый пароль">
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </Field>
          <ErrorText error={error} />
          {ok ? <p className="text-sm text-ok">{ok}</p> : null}
          <Button type="submit" disabled={busy} className="w-full">
            Сохранить
          </Button>
        </form>
      </Card>
    </div>
  );
}
