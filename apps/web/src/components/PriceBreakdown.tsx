'use client';

import { PriceCalculation } from '@/lib/types';
import { money } from '@/lib/format';
import { CLIENT_CATEGORY_LABELS, CLIENT_TYPE_LABELS } from '@/lib/types';
import { Card } from '@/components/ui';

export function PriceBreakdown({ data }: { data: PriceCalculation }) {
  const clientMarkupLabel = `${CLIENT_TYPE_LABELS[data.clientType]} + ${CLIENT_CATEGORY_LABELS[data.clientCategory]}`;

  return (
    <Card className="space-y-2 font-mono text-sm">
      <p className="flex justify-between gap-4">
        <span className="text-muted">Себестоимость:</span>
        <span>{money(data.costPriceKgs)}</span>
      </p>
      <p className="flex justify-between gap-4">
        <span className="text-muted">Базовая наценка товара:</span>
        <span>{data.baseMarkupPercent}%</span>
      </p>
      <p className="flex justify-between gap-4">
        <span className="text-muted">Наценка {clientMarkupLabel}:</span>
        <span>{data.clientMarkupPercent}%</span>
      </p>
      <p className="flex justify-between gap-4 border-t border-line pt-2 font-semibold">
        <span>Итоговая наценка:</span>
        <span>{data.finalMarkupPercent}%</span>
      </p>
      <p className="flex justify-between gap-4 font-semibold">
        <span>Итоговая цена:</span>
        <span>{money(data.finalPriceKgs)}</span>
      </p>
    </Card>
  );
}
