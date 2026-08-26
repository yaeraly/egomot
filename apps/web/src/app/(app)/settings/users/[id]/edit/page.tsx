'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ManagedUser } from '@/lib/types';
import { PageHeader } from '@/components/ui';
import { UserForm } from '@/components/UserForm';

export default function EditSettingsUserPage() {
  const { id } = useParams<{ id: string }>();
  const [user, setUser] = useState<ManagedUser | null>(null);

  useEffect(() => {
    void api<ManagedUser>(`/users/${id}`).then(setUser);
  }, [id]);

  if (!user) return <p className="text-muted">Загрузка…</p>;

  return (
    <div>
      <PageHeader title="Редактирование пользователя" />
      <UserForm user={user} />
    </div>
  );
}
