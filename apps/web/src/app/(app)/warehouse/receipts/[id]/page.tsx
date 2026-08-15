'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatBusinessDate, money, qty, weight } from '@/lib/format';
import {
  DISCREPANCY_LABELS,
  PurchaseReceipt,
  PurchaseReceiptStatus,
  RECEIPT_STATUS_LABELS,
  ReceiptCalculationPreview,
} from '@/lib/types';
import { Badge, Button, Card, ErrorText, Field, Input, PageHeader, Textarea } from '@/components/ui';

function diffTone(value: string): 'slate' | 'red' | 'amber' {
  const n = Number(value);
  if (n < 0) return 'red';
  if (n > 0) return 'amber';
  return 'slate';
}

export default function ReceiptDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [receipt, setReceipt] = useState<PurchaseReceipt | null>(null);
  const [preview, setPreview] = useState<ReceiptCalculationPreview | null>(null);
  const [received, setReceived] = useState<Record<string, string>>({});
  const [transport, setTransport] = useState({ china: '', cargo: '', kg: '' });
  const [comments, setComments] = useState<Record<string, string>>({});
  const [comment, setComment] = useState('');
  const [warehouseReceiptDate, setWarehouseReceiptDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const editable = receipt?.status === 'DRAFT' || receipt?.status === 'RECEIVING';

  const load = useCallback(async () => {
    const data = await api<PurchaseReceipt>(`/purchase-receipts/${id}`);
    setReceipt(data);
    setComment(data.comment ?? '');
    setWarehouseReceiptDate(data.warehouseReceiptDate?.split('T')[0] ?? '');
    setTransport({
      china: data.chinaInternalTransportKgs,
      cargo: data.cargoKgs,
      kg: data.kyrgyzstanInternalTransportKgs,
    });
    const map: Record<string, string> = {};
    for (const item of data.items ?? []) {
      map[item.productId] = item.receivedQuantity;
    }
    setReceived(map);
    const calc = await api<ReceiptCalculationPreview>(`/purchase-receipts/${id}/calculate`);
    setPreview(calc);
  }, [id]);

  useEffect(() => {
    void load().catch((e: unknown) => {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить приход');
    });
  }, [load]);

  const previewByProduct = useMemo(() => {
    const map = new Map<string, ReceiptCalculationPreview['items'][number]>();
    for (const row of preview?.items ?? []) {
      map.set(row.productId, row);
    }
    return map;
  }, [preview]);

  async function saveDraft() {
    if (!receipt) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/purchase-receipts/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          comment,
          warehouseReceiptDate: editable ? warehouseReceiptDate : undefined,
          transport: {
            chinaInternalTransportKgs: transport.china,
            cargoKgs: transport.cargo,
            kyrgyzstanInternalTransportKgs: transport.kg,
          },
          items: Object.entries(received).map(([productId, receivedQuantity]) => ({
            productId,
            receivedQuantity,
          })),
        }),
      });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  }

  async function completeReceipt() {
    setBusy(true);
    setError(null);
    try {
      await saveDraftInternal();
      await api(`/purchase-receipts/${id}/complete`, {
        method: 'POST',
        body: JSON.stringify({
          discrepancyComments: Object.entries(comments)
            .filter(([, value]) => value.trim())
            .map(([productId, commentValue]) => ({ productId, comment: commentValue })),
        }),
      });
      setConfirmOpen(false);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось завершить приход');
    } finally {
      setBusy(false);
    }
  }

  async function saveDraftInternal() {
    await api(`/purchase-receipts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        comment,
        warehouseReceiptDate,
        transport: {
          chinaInternalTransportKgs: transport.china,
          cargoKgs: transport.cargo,
          kyrgyzstanInternalTransportKgs: transport.kg,
        },
        items: Object.entries(received).map(([productId, receivedQuantity]) => ({
          productId,
          receivedQuantity,
        })),
      }),
    });
  }

  async function cancelReceipt() {
    if (!confirm('Отменить приход?')) return;
    setBusy(true);
    try {
      await api(`/purchase-receipts/${id}/cancel`, { method: 'POST', body: '{}' });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось отменить');
    } finally {
      setBusy(false);
    }
  }

  if (!receipt) {
    return <p className="text-muted">{error ?? 'Загрузка…'}</p>;
  }

  const statusTone: Record<PurchaseReceiptStatus, 'slate' | 'teal' | 'green' | 'red' | 'blue'> = {
    DRAFT: 'slate',
    RECEIVING: 'blue',
    COMPLETED: 'green',
    CANCELLED: 'red',
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={receipt.number}
        subtitle={`Приём товаров · ${receipt.purchase?.number ?? ''}`}
        action={
          editable ? (
            <Button disabled={busy} onClick={() => void saveDraft()} className="w-full sm:w-auto">
              Сохранить
            </Button>
          ) : null
        }
      />

      <Badge tone={statusTone[receipt.status]}>{RECEIPT_STATUS_LABELS[receipt.status]}</Badge>
      <ErrorText error={error} />

      <Card className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-sm text-muted">Закупка</p>
          <Link href={`/purchases/${receipt.purchaseId}`} className="font-medium text-brand">
            {receipt.purchase?.number}
          </Link>
        </div>
        <div>
          <p className="text-sm text-muted">Поставщик</p>
          <p className="font-medium">{receipt.supplier?.name}</p>
        </div>
        <div>
          <p className="text-sm text-muted">Дата поступления на склад</p>
          {editable ? (
            <Input type="date" className="mt-1" value={warehouseReceiptDate} onChange={(e) => setWarehouseReceiptDate(e.target.value)} />
          ) : (
            <p>{formatBusinessDate(receipt.warehouseReceiptDate)}</p>
          )}
        </div>
        <div>
          <p className="text-sm text-muted">Дата закупки</p>
          <p>{formatBusinessDate(receipt.purchase?.purchaseDate ?? null)}</p>
        </div>
        <div>
          <p className="text-sm text-muted">Ответственный</p>
          <p>{receipt.receivedBy?.name}</p>
        </div>
      </Card>

      {editable ? (
        <Card className="space-y-4">
          <p className="font-semibold">Транспортные расходы</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Китайский внутренний транспорт">
              <Input
                inputMode="decimal"
                value={transport.china}
                onChange={(e) => setTransport((s) => ({ ...s, china: e.target.value }))}
              />
            </Field>
            <Field label="Карго">
              <Input
                inputMode="decimal"
                value={transport.cargo}
                onChange={(e) => setTransport((s) => ({ ...s, cargo: e.target.value }))}
              />
            </Field>
            <Field label="Кыргызстанский внутренний транспорт">
              <Input
                inputMode="decimal"
                value={transport.kg}
                onChange={(e) => setTransport((s) => ({ ...s, kg: e.target.value }))}
              />
            </Field>
          </div>
          <p className="text-sm">
            Общие транспортные расходы:{' '}
            <span className="font-semibold">
              {money(
                String(Number(transport.china || 0) + Number(transport.cargo || 0) + Number(transport.kg || 0)),
                'KGS',
              )}
            </span>
          </p>
          <Field label="Комментарий">
            <Textarea value={comment} onChange={(e) => setComment(e.target.value)} />
          </Field>
        </Card>
      ) : (
        <Card className="grid gap-2 sm:grid-cols-2">
          <p className="sm:col-span-2 font-semibold">Транспортные расходы</p>
          <p>Китай: {money(receipt.chinaInternalTransportKgs, 'KGS')}</p>
          <p>Карго: {money(receipt.cargoKgs, 'KGS')}</p>
          <p>КР: {money(receipt.kyrgyzstanInternalTransportKgs, 'KGS')}</p>
          <p className="font-semibold">Итого: {money(receipt.totalTransportKgs, 'KGS')}</p>
        </Card>
      )}

      <Card>
        <p className="mb-3 font-semibold">Товары</p>
        <div className="space-y-3">
          {(receipt.items ?? []).map((item) => {
            const calc = previewByProduct.get(item.productId);
            const diff = calc?.difference ?? item.difference;
            return (
              <div key={item.id} className="rounded-xl border border-line p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{item.product?.name}</p>
                    <p className="text-xs text-muted">{item.product?.code}</p>
                  </div>
                  <Badge tone={diffTone(diff)}>{qty(diff)}</Badge>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-muted">Заказано</p>
                    <p>{qty(item.orderedQuantity)}</p>
                  </div>
                  <div>
                    <p className="text-muted">Фактически</p>
                    {editable ? (
                      <Input
                        inputMode="decimal"
                        className="mt-1 min-h-11"
                        value={received[item.productId] ?? ''}
                        onChange={(e) =>
                          setReceived((s) => ({ ...s, [item.productId]: e.target.value }))
                        }
                      />
                    ) : (
                      <p>{qty(item.receivedQuantity)}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-muted">Вес</p>
                    <p>{weight(calc?.totalWeightKg ?? item.totalWeightKg)}</p>
                  </div>
                  <div>
                    <p className="text-muted">Цена CNY</p>
                    <p>{money(item.unitPriceCny, 'CNY')}</p>
                  </div>
                  <div>
                    <p className="text-muted">Транспорт</p>
                    <p>{money(calc?.totalAllocatedTransportKgs ?? item.totalAllocatedTransportKgs, 'KGS')}</p>
                  </div>
                  <div>
                    <p className="text-muted">Себестоимость</p>
                    <p>{money(calc?.totalLandedCostKgs ?? item.totalLandedCostKgs, 'KGS')}</p>
                  </div>
                  <div>
                    <p className="text-muted">Ед. себест.</p>
                    <p>{money(calc?.unitLandedCostKgs ?? item.unitLandedCostKgs, 'KGS')}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {(receipt.discrepancies?.length ?? 0) > 0 || (preview?.discrepancies.length ?? 0) > 0 ? (
        <Card>
          <p className="mb-3 font-semibold">Расхождения</p>
          <div className="space-y-3">
            {(receipt.status === 'COMPLETED' ? receipt.discrepancies : preview?.discrepancies)?.map(
              (d, idx) => {
                const product =
                  receipt.items?.find((i) => i.productId === d.productId)?.product ??
                  receipt.discrepancies?.find((x) => x.productId === d.productId)?.product;
                return (
                  <div key={`${d.productId}-${idx}`} className="rounded-xl border border-line p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">{product?.name ?? d.productId}</p>
                      <Badge tone={d.type === 'SHORTAGE' ? 'red' : 'amber'}>
                        {DISCREPANCY_LABELS[d.type as keyof typeof DISCREPANCY_LABELS]}
                      </Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2">
                      <div>
                        <p className="text-muted">Заказано</p>
                        <p>{qty(d.orderedQuantity)}</p>
                      </div>
                      <div>
                        <p className="text-muted">Принято</p>
                        <p>{qty(d.receivedQuantity)}</p>
                      </div>
                      <div>
                        <p className="text-muted">Разница</p>
                        <p>{qty(d.difference)}</p>
                      </div>
                    </div>
                    {editable && d.type === 'SHORTAGE' ? (
                      <Field label="Комментарий">
                        <Input
                          placeholder="Например: 2 шт не пришли"
                          value={comments[d.productId] ?? ''}
                          onChange={(e) =>
                            setComments((s) => ({ ...s, [d.productId]: e.target.value }))
                          }
                        />
                      </Field>
                    ) : 'comment' in d && typeof d.comment === 'string' && d.comment ? (
                      <p className="mt-2 text-muted">{d.comment}</p>
                    ) : null}
                  </div>
                );
              },
            )}
          </div>
        </Card>
      ) : null}

      {preview ? (
        <Card className="grid gap-2 sm:grid-cols-2">
          <p className="sm:col-span-2 font-semibold">Итого</p>
          <p>Заказано: {qty(preview.totals.totalOrderedQuantity)}</p>
          <p>Принято: {qty(preview.totals.totalReceivedQuantity)}</p>
          <p>Недостача: {qty(preview.totals.totalShortage)}</p>
          <p>Излишек: {qty(preview.totals.totalExcess)}</p>
          <p>Транспорт: {money(preview.totals.totalTransportKgs, 'KGS')}</p>
          <p className="font-semibold">Себестоимость: {money(preview.totals.totalLandedCostKgs, 'KGS')}</p>
        </Card>
      ) : null}

      {editable ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button disabled={busy} onClick={() => setConfirmOpen(true)}>
            Завершить приём
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => void cancelReceipt()}>
            Отменить
          </Button>
        </div>
      ) : receipt.status === 'COMPLETED' ? (
        <Button variant="secondary" onClick={() => router.push('/warehouse/movements')}>
          Смотреть движения
        </Button>
      ) : null}

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <Card className="w-full max-w-md space-y-4">
            <p className="text-lg font-semibold">Подтвердить прием товара?</p>
            {preview ? (
              <div className="space-y-1 text-sm">
                <p>Заказано: {qty(preview.totals.totalOrderedQuantity)}</p>
                <p>Принято: {qty(preview.totals.totalReceivedQuantity)}</p>
                <p>Недостача: {qty(preview.totals.totalShortage)}</p>
                <p>Излишек: {qty(preview.totals.totalExcess)}</p>
                <p>Транспорт: {money(preview.totals.totalTransportKgs, 'KGS')}</p>
                <p className="font-semibold">Себестоимость: {money(preview.totals.totalLandedCostKgs, 'KGS')}</p>
              </div>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button disabled={busy} onClick={() => void completeReceipt()}>
                Подтвердить
              </Button>
              <Button variant="secondary" onClick={() => setConfirmOpen(false)}>
                Отмена
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
