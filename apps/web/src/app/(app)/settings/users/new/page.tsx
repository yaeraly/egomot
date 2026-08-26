'use client';

import { PageHeader } from '@/components/ui';
import { UserForm } from '@/components/UserForm';

export default function NewSettingsUserPage() {
  return (
    <div>
      <PageHeader title="Новый пользователь" />
      <UserForm />
    </div>
  );
}
