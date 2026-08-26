'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate, formatBusinessDate, moneySom } from '@/lib/format';
import { AuditLog, Purchase, PurchaseStatus, STATUS_LABELS } from '@/lib/types';
import { Badge, Button, Card, PageHeader, Select } from '@/components/ui';
import { PurchaseSummary } from '@/components/PurchaseSummary';
import { PurchaseLogisticsSection } from '@/components/PurchaseLogisticsSection';
import { SupplierPaymentModal } from '@/components/SupplierPaymentModal';
import { PAYABLE_STATUS_LABELS } from '@/lib/finance-labels';
import {
  type CompanyPaymentAccount,
  supplierPaymentTargetFromPurchase,
} from '@/lib/supplier-payment';

export default function PurchaseViewPage() {
  const { id } = useParams<{ id: string }>();
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [status, setStatus] = useState<PurchaseStatus>('DRAFT');
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<CompanyPaymentAccount[]>([]);
  const [supplierPaymentOpen, setSupplierPaymentOpen] = useState(false);

  async function load() {
    const data = await api<Purchase>(`/purchases/${id}`);
    setPurchase(data);
    setStatus(data.status);
    const audit = await api<AuditLog[]>(`/purchases/${id}/audit-logs`);
    setLogs(audit);
  }

  useEffect(() => {
    void load();
    void api<CompanyPaymentAccount[]>('/accounting/company-accounts').then(setAccounts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function changeStatus() {
    setBusy(true);
    try {
      await api(`/purchases/${id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!purchase) return <p className="text-muted">Загрузка…</p>;

  const canReceive =
    purchase.status !== 'DRAFT' &&
    purchase.status !== 'RECEIVED' &&
    purchase.status !== 'RECEIVED_WITH_DISCREPANCY';
  const supplierPaymentTarget = supplierPaymentTargetFromPurchase(purchase);
  const canPaySupplier = supplierPaymentTarget !== null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={purchase.number}
        subtitle={purchase.supplier?.name}
        action={
          <div className="flex flex-col gap-2 sm:flex-row">
            {canReceive ? (
              <Link
                href={`/warehouse/receipts/new?purchaseId=${id}`}
                className="inline-flex min-h-12 items-center justify-center rounded-xl border border-brand px-4 font-semibold text-brand"
              >
                Приём товара
              </Link>
            ) : null}
            <Link href={`/purchases/${id}/edit`} className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white">
              Изменить
            </Link>
          </div>
        }
      />
      <Badge>{STATUS_LABELS[purchase.status]}</Badge>
      {purchase.purchaseDate ? (
        <p className="text-sm text-muted">Дата закупки: {formatBusinessDate(purchase.purchaseDate)}</p>
      ) : (
        <p className="text-sm text-amber-700">Дата закупки не указана — укажите при редактировании</p>
      )}
      <PurchaseSummary
        supplierName={purchase.supplier?.name}
        totals={purchase}
        items={(purchase.items ?? []).map((item) => ({
          ...item,
          productName: item.product?.name,
        }))}
      />
      <PurchaseLogisticsSection purchase={purchase} onChanged={load} />
      <Card className="grid gap-2 sm:grid-cols-2">
        <p className="sm:col-span-2 font-semibold">Расчёты и долги</p>
        <p>Стоимость товара: {moneySom(purchase.totalPurchaseCostKgs)}</p>
        <p>Оплачено поставщику: {moneySom(purchase.supplierPaidAmountKgs ?? '0')}</p>
        <p>Долг поставщику: {moneySom(purchase.supplierUnpaidAmountKgs ?? '0')}</p>
        <p>Транспорт по Китаю: {moneySom(purchase.totalChinaTransportKgs)}</p>
        <p>Оплачено: {moneySom(purchase.chinaTransportPaidKgs ?? '0')}</p>
        <p>Долг: {moneySom(purchase.chinaTransportUnpaidKgs ?? '0')}</p>
        <p>Карго: {moneySom(purchase.totalCargoKgs)}</p>
        <p>Оплачено: {moneySom(purchase.cargoPaidKgs ?? '0')}</p>
        <p>Долг: {moneySom(purchase.cargoUnpaidKgs ?? '0')}</p>
        <p>Транспорт по Кыргызстану: {moneySom(purchase.totalKgInternalTransportKgs)}</p>
        <p>Оплачено: {moneySom(purchase.kgInternalTransportPaidKgs ?? '0')}</p>
        <p>Долг: {moneySom(purchase.kgInternalTransportUnpaidKgs ?? '0')}</p>
        <p>Общие логистические расходы: {moneySom(purchase.totalLogisticsKgs)}</p>
        <p className="sm:col-span-2 font-semibold">
          Итоговая себестоимость закупки: {moneySom(purchase.estimatedTotalLandedCostKgs)}
        </p>
        <p className="sm:col-span-2 font-semibold">
          Общая задолженность: {moneySom(purchase.totalUnpaidAmountKgs ?? purchase.unpaidAmountKgs ?? '0')}
        </p>
        <p>
          Статус:{' '}
          <Badge
            tone={
              purchase.payableStatus === 'PAID'
                ? 'green'
                : purchase.payableStatus === 'PARTIAL'
                  ? 'amber'
                  : 'red'
            }
          >
            {PAYABLE_STATUS_LABELS[purchase.payableStatus ?? 'UNPAID'] ?? purchase.payableStatus}
          </Badge>
        </p>
        {canPaySupplier ? (
          <div className="sm:col-span-2">
            <Button variant="secondary" onClick={() => setSupplierPaymentOpen(true)}>
              Оплатить поставщику
            </Button>
          </div>
        ) : null}
      </Card>

      <SupplierPaymentModal
        open={supplierPaymentOpen}
        target={supplierPaymentTarget}
        accounts={accounts}
        onClose={() => setSupplierPaymentOpen(false)}
        onSuccess={load}
      />

      <Card className="space-y-3">
        <p className="font-semibold">Статус</p>
        <Select value={status} onChange={(e) => setStatus(e.target.value as PurchaseStatus)}>
          {(Object.keys(STATUS_LABELS) as PurchaseStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Button disabled={busy || status === purchase.status} onClick={() => void changeStatus()} className="w-full sm:w-auto">
          Обновить статус
        </Button>
      </Card>

      <Card>
        <p className="mb-3 font-semibold">Журнал аудита</p>
        <div className="space-y-3">
          {logs.length === 0 ? (
            <p className="text-sm text-muted">Записей нет</p>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="border-b border-line pb-3 text-sm last:border-0">
                <p className="font-medium">{log.action}</p>
                <p className="text-muted">
                  {log.user.name} · {formatDate(log.createdAt)}
                </p>
                <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all text-xs text-slate-600">
                  {JSON.stringify({ old: log.oldValue, new: log.newValue }, null, 2)}
                </pre>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
