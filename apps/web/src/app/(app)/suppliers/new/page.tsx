'use client';

import { PageHeader } from '@/components/ui';
import { SupplierForm } from '@/components/SupplierForm';

export default function NewSupplierPage() {
  return (
    <div>
      <PageHeader title="Новый поставщик" />
      <SupplierForm />
    </div>
  );
}
