'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { AuditLog, Purchase, PurchaseStatus, STATUS_LABELS } from '@/lib/types';
import { Badge, Button, Card, PageHeader, Select } from '@/components/ui';
import { PurchaseSummary } from '@/components/PurchaseSummary';

export default function PurchaseViewPage() {
  const { id } = useParams<{ id: string }>();
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [status, setStatus] = useState<PurchaseStatus>('DRAFT');
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await api<Purchase>(`/purchases/${id}`);
    setPurchase(data);
    setStatus(data.status);
    const audit = await api<AuditLog[]>(`/purchases/${id}/audit-logs`);
    setLogs(audit);
  }

  useEffect(() => {
    void load();
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

  return (
    <div className="space-y-4">
      <PageHeader
        title={purchase.number}
        subtitle={purchase.supplier?.name}
        action={
          <Link href={`/purchases/${id}/edit`} className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white">
            Изменить
          </Link>
        }
      />
      <Badge>{STATUS_LABELS[purchase.status]}</Badge>
      <PurchaseSummary
        supplierName={purchase.supplier?.name}
        totals={purchase}
        items={(purchase.items ?? []).map((item) => ({
          ...item,
          productName: item.product?.name,
        }))}
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
