'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ManagedUser } from '@/lib/types';
import { Badge, EmptyState, PageHeader, SearchBox } from '@/components/ui';

export default function SettingsUsersPage() {
  const [items, setItems] = useState<ManagedUser[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      const q = search ? `?search=${encodeURIComponent(search)}` : '';
      void api<ManagedUser[]>(`/users${q}`).then(setItems);
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  return (
    <div>
      <PageHeader
        title="Пользователи"
        subtitle="Аккаунты операторов"
        action={
          <Link
            href="/settings/users/new"
            className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white"
          >
            + Пользователь
          </Link>
        }
      />
      <SearchBox value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по имени или email" />
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <EmptyState
            title="Нет пользователей"
            text="Создайте аккаунт для оператора продаж или склада"
            href="/settings/users/new"
            actionLabel="Создать пользователя"
          />
        ) : (
          items.map((user) => (
            <Link
              key={user.id}
              href={`/settings/users/${user.id}`}
              className="block rounded-2xl border border-line bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{user.name}</p>
                  <p className="mt-1 text-sm text-muted">{user.email}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge tone={user.isActive ? 'green' : 'slate'}>
                    {user.isActive ? 'Активен' : 'Архив'}
                  </Badge>
                  <span className="text-xs text-muted">{user.role}</span>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
