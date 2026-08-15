'use client';

import { PageHeader } from '@/components/ui';
import { ClientForm } from '@/components/ClientForm';

export default function NewClientPage() {
  return (
    <div>
      <PageHeader title="Новый клиент" />
      <ClientForm />
    </div>
  );
}
