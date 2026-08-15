'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ApiError, loginErrorMessage } from '@/lib/api';
import { Button, ErrorText, Field, Input } from '@/components/ui';

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('owner@egomot.local');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) {
    router.replace('/');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      router.replace('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : loginErrorMessage(0));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-950 px-4">
      <form onSubmit={onSubmit} className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
        <p className="text-sm font-semibold text-brand">Egomot</p>
        <h1 className="mt-1 text-2xl font-bold">Вход владельца</h1>
        <p className="mt-1 text-sm text-muted">Управление товарами, поставщиками и закупками из Китая</p>
        <div className="mt-6 space-y-4">
          <Field label="Email">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
          </Field>
          <Field label="Пароль">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </Field>
          <ErrorText error={error} />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? 'Вход…' : 'Войти'}
          </Button>
        </div>
      </form>
    </div>
  );
}
