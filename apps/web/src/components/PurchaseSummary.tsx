'use client';

import { Purchase, PurchaseItem, PurchasePreview, STATUS_LABELS } from '@/lib/types';
import { money, qty, rate, weight } from '@/lib/format';
import { Card } from './ui';

type Totals = PurchasePreview['totals'] | Pick<
  Purchase,
  | 'totalPositions'
  | 'totalQuantity'
  | 'totalWeightKg'
  | 'totalPurchaseCny'
  | 'totalPurchaseCostKgs'
  | 'totalChinaTransportKgs'
  | 'totalCargoKgs'
  | 'totalKgInternalTransportKgs'
  | 'totalOtherLogisticsKgs'
  | 'totalLogisticsKgs'
  | 'estimatedTotalLandedCostKgs'
  | 'averageLogisticsCostPerKg'
  | 'exchangeRateCnyToKgs'
>;

export function PurchaseSummary({
  supplierName,
  totals,
  items,
}: {
  supplierName?: string;
  totals: Totals;
  items: Array<
    Pick<
      PurchaseItem,
      | 'productId'
      | 'quantity'
      | 'totalWeightKg'
      | 'unitPriceCny'
      | 'purchaseCostKgs'
      | 'totalAllocatedLogisticsKgs'
      | 'estimatedLandedCostKgs'
      | 'estimatedUnitLandedCostKgs'
    > & { productName?: string }
  >;
}) {
  const rows: Array<[string, string]> = [
    ['Поставщик', supplierName || '—'],
    ['Позиций', String(totals.totalPositions)],
    ['Количество', qty(totals.totalQuantity)],
    ['Вес', weight(totals.totalWeightKg)],
    ['Сумма закупки', money(totals.totalPurchaseCny, 'CNY')],
    ['Курс CNY → KGS', rate(totals.exchangeRateCnyToKgs)],
    ['Себестоимость закупки', money(totals.totalPurchaseCostKgs, 'KGS')],
    ['Доставка Китай', money(totals.totalChinaTransportKgs, 'KGS')],
    ['Карго', money(totals.totalCargoKgs, 'KGS')],
    ['Доставка КР', money(totals.totalKgInternalTransportKgs, 'KGS')],
    ['Прочая логистика', money(totals.totalOtherLogisticsKgs, 'KGS')],
    ['Итого логистика', money(totals.totalLogisticsKgs, 'KGS')],
    ['Ориентир. landed cost', money(totals.estimatedTotalLandedCostKgs, 'KGS')],
    ['Логистика за кг', money(totals.averageLogisticsCostPerKg, 'KGS/кг')],
  ];

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-3 text-sm">
            <span className="text-muted">{label}</span>
            <span className="text-right font-medium">{value}</span>
          </div>
        ))}
      </Card>

      <div className="space-y-3 md:hidden">
        {items.map((item) => (
          <Card key={item.productId}>
            <p className="font-semibold">{item.productName || item.productId}</p>
            <dl className="mt-2 space-y-1 text-sm">
              <Row k="Кол-во" v={qty(item.quantity)} />
              <Row k="Вес" v={weight(item.totalWeightKg)} />
              <Row k="Цена CNY" v={money(item.unitPriceCny, 'CNY')} />
              <Row k="Закупка KGS" v={money(item.purchaseCostKgs, 'KGS')} />
              <Row k="Логистика" v={money(item.totalAllocatedLogisticsKgs, 'KGS')} />
              <Row k="Landed" v={money(item.estimatedLandedCostKgs, 'KGS')} />
              <Row k="За ед." v={money(item.estimatedUnitLandedCostKgs, 'KGS')} />
            </dl>
          </Card>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="py-2 pr-3">Товар</th>
              <th className="py-2 pr-3">Кол-во</th>
              <th className="py-2 pr-3">Вес</th>
              <th className="py-2 pr-3">Цена CNY</th>
              <th className="py-2 pr-3">Закупка KGS</th>
              <th className="py-2 pr-3">Логистика</th>
              <th className="py-2 pr-3">Landed</th>
              <th className="py-2">За ед.</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.productId} className="border-b border-line">
                <td className="py-2 pr-3 font-medium">{item.productName || item.productId}</td>
                <td className="py-2 pr-3">{qty(item.quantity)}</td>
                <td className="py-2 pr-3">{weight(item.totalWeightKg)}</td>
                <td className="py-2 pr-3">{money(item.unitPriceCny)}</td>
                <td className="py-2 pr-3">{money(item.purchaseCostKgs)}</td>
                <td className="py-2 pr-3">{money(item.totalAllocatedLogisticsKgs)}</td>
                <td className="py-2 pr-3">{money(item.estimatedLandedCostKgs)}</td>
                <td className="py-2">{money(item.estimatedUnitLandedCostKgs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

export { STATUS_LABELS };
