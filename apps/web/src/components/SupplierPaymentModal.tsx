'use client';

import { useEffect, useState } from 'react';
import { ApiError } from '@/lib/api';
import { todayInputValue } from '@/lib/date';
import { formatBusinessDate, moneySom } from '@/lib/format';
import {
  type CompanyPaymentAccount,
  type SupplierPayablePaymentTarget,
  type SupplierPaymentFormValues,
  submitSupplierPayment,
  validateSupplierPaymentForm,
} from '@/lib/supplier-payment';
import { companyAccountLabel } from '@/lib/finance-labels';
import { Button, Card, ErrorText, Field, Input, Select, Textarea } from '@/components/ui';

interface SupplierPaymentModalProps {
  open: boolean;
  target: SupplierPayablePaymentTarget | null;
  accounts: CompanyPaymentAccount[];
  onClose: () => void;
  onSuccess: () => void | Promise<void>;
}

function defaultForm(target: SupplierPayablePaymentTarget | null): SupplierPaymentFormValues {
  return {
    amountKgs: target?.remainingAmountKgs ?? '',
    paymentAccountId: '',
    paidAt: todayInputValue(),
    note: '',
  };
}

export function SupplierPaymentModal({
  open,
  target,
  accounts,
  onClose,
  onSuccess,
}: SupplierPaymentModalProps) {
  const [form, setForm] = useState<SupplierPaymentFormValues>(() => defaultForm(target));
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
      await submitSupplierPayment(paymentTarget.purchaseId, form);
      await onSuccess();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'Не удалось провести оплату поставщику');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <Card className="w-full max-w-lg space-y-4">
        <p className="text-lg font-semibold">Оплата поставщику</p>

        <div className="space-y-1 text-sm">
          <p>
            <span className="text-muted">Поставщик:</span> {paymentTarget.supplierName}
          </p>
          <p>
            <span className="text-muted">Закупка:</span> {paymentTarget.purchaseNumber}
          </p>
          <p>
            <span className="text-muted">Общая сумма:</span> {moneySom(paymentTarget.amountKgs)}
          </p>
          <p>
            <span className="text-muted">Уже оплачено:</span> {moneySom(paymentTarget.paidAmountKgs)}
          </p>
          <p>
            <span className="text-muted">Остаток долга:</span>{' '}
            <span className="font-semibold">{moneySom(paymentTarget.remainingAmountKgs)}</span>
          </p>
          {paymentTarget.dueDate ? (
            <p>
              <span className="text-muted">Срок оплаты:</span>{' '}
              {formatBusinessDate(paymentTarget.dueDate)}
            </p>
          ) : null}
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
