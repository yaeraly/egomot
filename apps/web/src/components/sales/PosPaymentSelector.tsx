'use client';

import { useMemo, useState } from 'react';
import { PaymentAccount } from '@/lib/types';
import { money } from '@/lib/format';
import { Button, Field, Input } from '@/components/ui';

type Props = {
  accounts: PaymentAccount[];
  payments: Record<string, string>;
  onPaymentsChange: (payments: Record<string, string>) => void;
  totalAmount: number;
  paidAmount: number;
  debtAmount: number;
};

export function PosPaymentSelector({
  accounts,
  payments,
  onPaymentsChange,
  totalAmount,
  paidAmount,
  debtAmount,
}: Props) {
  const [activeIds, setActiveIds] = useState<string[]>([]);

  const available = useMemo(
    () => accounts.filter((acc) => !activeIds.includes(acc.id)),
    [accounts, activeIds],
  );

  function addMethod(accountId: string) {
    setActiveIds((prev) => (prev.includes(accountId) ? prev : [...prev, accountId]));
  }

  function removeMethod(accountId: string) {
    setActiveIds((prev) => prev.filter((id) => id !== accountId));
    onPaymentsChange({ ...payments, [accountId]: '' });
  }

  function setAmount(accountId: string, value: string) {
    onPaymentsChange({ ...payments, [accountId]: value });
  }

  function fillRemaining(accountId: string) {
    const remaining = Math.max(0, totalAmount - paidAmount + Number(payments[accountId] || 0));
    onPaymentsChange({ ...payments, [accountId]: remaining > 0 ? String(remaining) : '' });
  }

  const activeAccounts = accounts.filter((acc) => activeIds.includes(acc.id));

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-sm font-medium text-ink">Способ оплаты</p>
        {available.length === 0 && activeAccounts.length === 0 ? (
          <p className="text-sm text-muted">Платёжные счета не настроены</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {available.map((acc) => (
              <Button
                key={acc.id}
                type="button"
                variant="secondary"
                className="min-h-10 px-3 text-sm"
                onClick={() => addMethod(acc.id)}
              >
                + {acc.paymentMethod.name}
              </Button>
            ))}
          </div>
        )}
      </div>

      {activeAccounts.length > 0 ? (
        <div className="space-y-3">
          {activeAccounts.map((acc) => (
            <div key={acc.id} className="rounded-xl border border-line p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{acc.paymentMethod.name}</p>
                  <p className="text-xs text-muted">{acc.name}</p>
                </div>
                <button
                  type="button"
                  className="text-sm text-danger"
                  onClick={() => removeMethod(acc.id)}
                >
                  Убрать
                </button>
              </div>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                  <Field label="Сумма">
                    <Input
                      inputMode="decimal"
                      value={payments[acc.id] ?? ''}
                      onChange={(e) => setAmount(acc.id, e.target.value)}
                      placeholder="0"
                    />
                  </Field>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  className="mt-6 min-h-12 shrink-0 px-3 text-sm"
                  onClick={() => fillRemaining(acc.id)}
                  disabled={totalAmount <= 0}
                >
                  Остаток
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">Выберите один или несколько способов оплаты</p>
      )}

      <div className="rounded-xl bg-page p-3 text-sm">
        <p>Оплачено: {money(String(paidAmount))}</p>
        <p className={debtAmount > 0 ? 'font-medium text-amber-700' : ''}>
          Новый долг по продаже: {money(String(debtAmount))}
        </p>
      </div>
    </div>
  );
}
