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
  | 'supplierPaidAmountKgs'
  | 'supplierUnpaidAmountKgs'
  | 'chinaTransportPaidKgs'
  | 'chinaTransportUnpaidKgs'
  | 'cargoPaidKgs'
  | 'cargoUnpaidKgs'
  | 'kgInternalTransportPaidKgs'
  | 'kgInternalTransportUnpaidKgs'
>;

type SettlementFields = {
  supplierPaidAmountKgs?: string;
  supplierUnpaidAmountKgs?: string;
  chinaTransportPaidKgs?: string;
  chinaTransportUnpaidKgs?: string;
  cargoPaidKgs?: string;
  cargoUnpaidKgs?: string;
  kgInternalTransportPaidKgs?: string;
  kgInternalTransportUnpaidKgs?: string;
};

function settlementOf(totals: Totals): SettlementFields | null {
  if ('supplierPaidAmountKgs' in totals || 'supplierUnpaidAmountKgs' in totals) {
    return totals as SettlementFields;
  }
  return null;
}

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
  const settlement = settlementOf(totals);
  const rows: Array<{ key: string; label: string; value: string }> = [
    { key: 'supplier', label: 'Поставщик', value: supplierName || '—' },
    { key: 'positions', label: 'Позиций', value: String(totals.totalPositions) },
    { key: 'qty', label: 'Количество', value: qty(totals.totalQuantity) },
    { key: 'weight', label: 'Вес', value: weight(totals.totalWeightKg) },
    { key: 'cny', label: 'Сумма закупки', value: money(totals.totalPurchaseCny, 'CNY') },
    { key: 'rate', label: 'Курс CNY → KGS', value: rate(totals.exchangeRateCnyToKgs) },
    { key: 'goods', label: 'Стоимость товара', value: money(totals.totalPurchaseCostKgs, 'KGS') },
  ];
  if (settlement) {
    rows.push(
      {
        key: 'goods-paid',
        label: 'Оплачено поставщику',
        value: money(settlement.supplierPaidAmountKgs ?? '0', 'KGS'),
      },
      {
        key: 'goods-debt',
        label: 'Долг поставщику',
        value: money(settlement.supplierUnpaidAmountKgs ?? '0', 'KGS'),
      },
    );
  }
  rows.push({
    key: 'china',
    label: 'Транспорт по Китаю',
    value: money(totals.totalChinaTransportKgs, 'KGS'),
  });
  if (settlement) {
    rows.push(
      {
        key: 'china-paid',
        label: 'Оплачено',
        value: money(settlement.chinaTransportPaidKgs ?? '0', 'KGS'),
      },
      {
        key: 'china-debt',
        label: 'Долг',
        value: money(settlement.chinaTransportUnpaidKgs ?? '0', 'KGS'),
      },
    );
  }
  rows.push({ key: 'cargo', label: 'Карго', value: money(totals.totalCargoKgs, 'KGS') });
  if (settlement) {
    rows.push(
      {
        key: 'cargo-paid',
        label: 'Оплачено',
        value: money(settlement.cargoPaidKgs ?? '0', 'KGS'),
      },
      {
        key: 'cargo-debt',
        label: 'Долг',
        value: money(settlement.cargoUnpaidKgs ?? '0', 'KGS'),
      },
    );
  }
  rows.push({
    key: 'kg',
    label: 'Транспорт по Кыргызстану',
    value: money(totals.totalKgInternalTransportKgs, 'KGS'),
  });
  if (settlement) {
    rows.push(
      {
        key: 'kg-paid',
        label: 'Оплачено',
        value: money(settlement.kgInternalTransportPaidKgs ?? '0', 'KGS'),
      },
      {
        key: 'kg-debt',
        label: 'Долг',
        value: money(settlement.kgInternalTransportUnpaidKgs ?? '0', 'KGS'),
      },
    );
  }
  rows.push(
    {
      key: 'logistics',
      label: 'Общие логистические расходы',
      value: money(totals.totalLogisticsKgs, 'KGS'),
    },
    {
      key: 'landed',
      label: 'Итоговая себестоимость закупки',
      value: money(totals.estimatedTotalLandedCostKgs, 'KGS'),
    },
    {
      key: 'per-kg',
      label: 'Логистика за кг',
      value: money(totals.averageLogisticsCostPerKg, 'KGS/кг'),
    },
  );

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-start justify-between gap-3 text-sm">
            <span className="text-muted">{row.label}</span>
            <span className="text-right font-medium">{row.value}</span>
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
