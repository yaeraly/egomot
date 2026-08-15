'use client';

import { Card, PageHeader } from '@/components/ui';

export default function WarehouseInventoryCountPage() {
  return (
    <div>
      <PageHeader title="Инвентаризация" subtitle="Складская инвентаризация" />
      <Card>
        <p className="text-sm text-muted">
          Модуль инвентаризации будет доступен в следующей фазе. Сейчас доступны остатки, приход и движения.
        </p>
      </Card>
    </div>
  );
}
