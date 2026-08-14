'use client';

import { PageHeader } from '@/components/ui';
import { PurchaseWizard } from '@/components/PurchaseWizard';

export default function NewPurchasePage() {
  return (
    <div>
      <PageHeader title="Новая закупка" subtitle="Пошаговое создание закупки из Китая" />
      <PurchaseWizard />
    </div>
  );
}
