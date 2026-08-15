'use client';

import { PageHeader } from '@/components/ui';
import { PaymentMethodForm } from '@/components/PaymentMethodForm';

export default function NewFinanceAccountPage() {
  return (
    <div>
      <PageHeader title="Новый счёт" subtitle="Способ оплаты для POS" />
      <PaymentMethodForm />
    </div>
  );
}
