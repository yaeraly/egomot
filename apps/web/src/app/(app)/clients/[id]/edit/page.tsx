'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Client } from '@/lib/types';
import { PageHeader } from '@/components/ui';
import { ClientForm } from '@/components/ClientForm';

export default function EditClientPage() {
  const { id } = useParams<{ id: string }>();
  const [client, setClient] = useState<Client | null>(null);

  useEffect(() => {
    void api<Client>(`/clients/${id}`).then(setClient);
  }, [id]);

  if (!client) return <p className="text-muted">Загрузка…</p>;

  return (
    <div>
      <PageHeader title="Редактирование клиента" subtitle={client.name} />
      <ClientForm client={client} />
    </div>
  );
}
