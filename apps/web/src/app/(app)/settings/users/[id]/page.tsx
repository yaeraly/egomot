'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ManagedUser } from '@/lib/types';
import { Badge, Card, PageHeader } from '@/components/ui';

export default function SettingsUserViewPage() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<ManagedUser | null>(null);

  useEffect(() => {
    void api<ManagedUser>(`/users/${id}`).then(setUser);
  }, [id]);

  if (!user) return <p className="text-muted">Загрузка…</p>;

  return (
    <div>
      <PageHeader
        title={user.name}
        action={
          <Link
            href={`/settings/users/${id}/edit`}
            className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white"
          >
            Изменить
          </Link>
        }
      />
      <Card className="space-y-2">
        <Badge tone={user.isActive ? 'green' : 'slate'}>
          {user.isActive ? 'Активен' : 'Архив'}
        </Badge>
        <p>Email: {user.email}</p>
        <p>Роль: {user.role}</p>
        <p className="text-sm text-muted">
          Создан: {new Date(user.createdAt).toLocaleString('ru-RU')}
        </p>
      </Card>
    </div>
  );
}
