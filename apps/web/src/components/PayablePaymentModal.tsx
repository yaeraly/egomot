'use client';

import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { todayInputValue } from '@/lib/date';
import { moneySom } from '@/lib/format';
import {
  type CompanyPaymentAccount,
  type PayablePaymentTarget,
  type SupplierPaymentFormValues,
  submitPayablePayment,
  validateSupplierPaymentForm,
} from '@/lib/supplier-payment';
import { companyAccountLabel } from '@/lib/finance-labels';
import { Button, Card, ErrorText, Field, Input, Select, Textarea } from '@/components/ui';

interface PayablePaymentModalProps {
  open: boolean;
  target: PayablePaymentTarget | null;
  accounts: CompanyPaymentAccount[];
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}

export function PayablePaymentModal({
  open,
  target,
  accounts,
  onClose,
  onSuccess,
}: PayablePaymentModalProps) {
  const [form, setForm] = useState<SupplierPaymentFormValues>({
    amountKgs: '',
    paymentAccountId: '',
    paidAt: todayInputValue(),
    note: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !target) return;
    setForm({
      amountKgs: target.remainingAmountKgs,
      paymentAccountId: accounts[0]?.id ?? '',
      paidAt: todayInputValue(),
      note: '',
    });
    setError(null);
  }, [open, target, accounts]);

  if (!open || !target) return null;
  const paymentTarget = target;

  async function handleSubmit() {
    const validationError = validateSupplierPaymentForm(form, paymentTarget.remainingAmountKgs);
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitPayablePayment(paymentTarget, form);
      await onSuccess();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'Не удалось провести оплату');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <Card className="w-full max-w-lg space-y-4">
        <p className="text-lg font-semibold">Оплатить долг</p>
        <div className="space-y-1 text-sm">
          <p>
            <span className="text-muted">Контрагент:</span> {paymentTarget.supplierName}
          </p>
          <p>
            <span className="text-muted">Закупка:</span> {paymentTarget.purchaseNumber}
          </p>
          <p>
            <span className="text-muted">Остаток долга:</span>{' '}
            <span className="font-semibold">{moneySom(paymentTarget.remainingAmountKgs)}</span>
          </p>
        </div>
        <Field label="Сумма оплаты *">
          <Input
            inputMode="decimal"
            value={form.amountKgs}
            onChange={(e) => setForm((s) => ({ ...s, amountKgs: e.target.value }))}
          />
        </Field>
        <Field label="Счёт оплаты *">
          <Select
            value={form.paymentAccountId}
            onChange={(e) => setForm((s) => ({ ...s, paymentAccountId: e.target.value }))}
          >
            {accounts.length === 0 ? (
              <option value="">Нет счетов компании</option>
            ) : (
              accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {companyAccountLabel(account)}
                </option>
              ))
            )}
          </Select>
        </Field>
        <Field label="Дата оплаты *">
          <Input
            type="date"
            value={form.paidAt}
            onChange={(e) => setForm((s) => ({ ...s, paidAt: e.target.value }))}
          />
        </Field>
        <Field label="Комментарий">
          <Textarea
            value={form.note}
            onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))}
            placeholder="Необязательно"
          />
        </Field>
        <ErrorText error={error} />
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button disabled={busy || accounts.length === 0} onClick={() => void handleSubmit()}>
            Оплатить
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Отмена
          </Button>
        </div>
      </Card>
    </div>
  );
}
