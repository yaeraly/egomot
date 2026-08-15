'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Purchase } from '@/lib/types';
import { Button, Card, EmptyState, ErrorText, Field, PageHeader, Select } from '@/components/ui';

const RECEIVABLE = new Set([
  'ORDERED',
  'PAID',
  'IN_CHINA_TRANSIT',
  'HANDED_TO_CARGO',
  'IN_TRANSIT_TO_KYRGYZSTAN',
  'ARRIVED',
]);

export default function NewReceiptPage() {
  const router = useRouter();
  const params = useSearchParams();
  const presetPurchaseId = params.get('purchaseId') ?? '';
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [purchaseId, setPurchaseId] = useState(presetPurchaseId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<Purchase[]>('/purchases').then((rows) =>
      setPurchases(rows.filter((p) => RECEIVABLE.has(p.status))),
    );
  }, []);

  useEffect(() => {
    if (presetPurchaseId) setPurchaseId(presetPurchaseId);
  }, [presetPurchaseId]);

  async function createReceipt() {
    if (!purchaseId) {
      setError('Выберите закупку');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const receipt = await api<{ id: string }>(`/purchases/${purchaseId}/receipts`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      router.push(`/warehouse/receipts/${receipt.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось создать приход');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader title="Новый приход" subtitle="Выберите закупку для приёма товаров" />
      {purchases.length === 0 ? (
        <EmptyState
          title="Нет закупок для приёма"
          text="Закупка должна быть оформлена и не полностью принята на склад"
          href="/purchases"
          actionLabel="К закупкам"
        />
      ) : (
        <Card className="space-y-4">
          <Field label="Закупка">
            <Select value={purchaseId} onChange={(e) => setPurchaseId(e.target.value)}>
              <option value="">Выберите закупку</option>
              {purchases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.number} — {p.supplier?.name}
                </option>
              ))}
            </Select>
          </Field>
          <ErrorText error={error} />
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button disabled={busy} onClick={() => void createReceipt()} className="w-full sm:w-auto">
              Создать приход
            </Button>
            <Link href="/warehouse/receipts" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-line px-4 text-sm font-semibold">
              Отмена
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
