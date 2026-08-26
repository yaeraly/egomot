'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { todayInputValue } from '@/lib/date';
import { formatBusinessDate, moneySom } from '@/lib/format';
import { companyAccountLabel } from '@/lib/finance-labels';
import {
  Currency,
  LogisticsType,
  Purchase,
  PurchaseLogistics,
} from '@/lib/types';
import { Badge, Button, Card, ErrorText, Field, Input, Select, Textarea } from '@/components/ui';

const LOGISTICS_TYPE_LABELS: Record<Exclude<LogisticsType, 'OTHER'>, string> = {
  CHINA_INTERNAL_TRANSPORT: 'Транспорт по Китаю',
  CARGO: 'Карго Китай → Кыргызстан',
  KYRGYZSTAN_INTERNAL_TRANSPORT: 'Транспорт по Кыргызстану',
};

const STATUS_LABELS: Record<string, string> = {
  UNPAID: 'Не оплачено',
  PARTIAL: 'Частично оплачено',
  PAID: 'Оплачено',
};

type Settlement = 'PAID' | 'PARTIAL' | 'UNPAID';

interface CompanyAccount {
  id: string;
  name: string;
  paymentMethodCode: string;
}

interface LogisticsForm {
  type: Exclude<LogisticsType, 'OTHER'>;
  expenseDate: string;
  payeeName: string;
  amount: string;
  currency: Currency;
  exchangeRate: string;
  comment: string;
  settlement: Settlement;
  paidAmountKgs: string;
  paymentAccountId: string;
  paidAt: string;
}

const emptyForm = (accountId = ''): LogisticsForm => ({
  type: 'CARGO',
  expenseDate: todayInputValue(),
  payeeName: '',
  amount: '',
  currency: 'KGS',
  exchangeRate: '',
  comment: '',
  settlement: 'UNPAID',
  paidAmountKgs: '',
  paymentAccountId: accountId,
  paidAt: todayInputValue(),
});

function kgsAmount(form: LogisticsForm): number {
  const amount = Number(form.amount);
  if (!Number.isFinite(amount)) return 0;
  if (form.currency === 'KGS') return amount;
  const rate = Number(form.exchangeRate);
  if (!Number.isFinite(rate)) return 0;
  return amount * rate;
}

function originalAmount(value: string) {
  const n = Number(value);
  if (Number.isNaN(n)) return value;
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(n);
}

export function PurchaseLogisticsSection({
  purchase,
  onChanged,
}: {
  purchase: Purchase;
  onChanged: () => Promise<void>;
}) {
  const [accounts, setAccounts] = useState<CompanyAccount[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payAccountId, setPayAccountId] = useState('');
  const [payDate, setPayDate] = useState(todayInputValue());
  const [form, setForm] = useState<LogisticsForm>(emptyForm());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api<CompanyAccount[]>('/accounting/company-accounts').then((rows) => {
      setAccounts(rows);
      setForm((current) => ({
        ...current,
        paymentAccountId: current.paymentAccountId || rows[0]?.id || '',
      }));
      setPayAccountId((id) => id || rows[0]?.id || '');
    });
  }, []);

  const computedKgs = kgsAmount(form);
  const paidKgs =
    form.settlement === 'PAID'
      ? computedKgs
      : form.settlement === 'UNPAID'
        ? 0
        : Number(form.paidAmountKgs) || 0;
  const remainingKgs = Math.max(0, computedKgs - paidKgs);

  const rows = purchase.logistics ?? [];

  function startCreate() {
    setEditingId(null);
    setForm(emptyForm(accounts[0]?.id || ''));
    setError(null);
    setOpen(true);
  }

  function startEdit(row: PurchaseLogistics) {
    setEditingId(row.id);
    setForm({
      type:
        row.type === 'OTHER'
          ? 'CARGO'
          : (row.type as Exclude<LogisticsType, 'OTHER'>),
      expenseDate: row.expenseDate || todayInputValue(),
      payeeName: row.payeeName || '',
      amount: row.amount,
      currency: row.currency,
      exchangeRate: row.exchangeRate || '',
      comment: row.comment || '',
      settlement:
        row.status === 'PAID' ? 'PAID' : row.status === 'PARTIAL' ? 'PARTIAL' : 'UNPAID',
      paidAmountKgs: row.paidAmountKgs || '0',
      paymentAccountId: row.paymentAccount?.id || accounts[0]?.id || '',
      paidAt: row.paidAt ? row.paidAt.slice(0, 10) : todayInputValue(),
    });
    setError(null);
    setOpen(true);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        type: form.type,
        expenseDate: form.expenseDate,
        payeeName: form.payeeName || null,
        amount: form.amount,
        currency: form.currency,
        exchangeRate: form.currency === 'KGS' ? form.exchangeRate || null : form.exchangeRate,
        comment: form.comment || null,
        settlement: form.settlement,
        paidAmountKgs: form.settlement === 'PARTIAL' ? form.paidAmountKgs : null,
        paymentAccountId: paidKgs > 0 ? form.paymentAccountId : null,
        paidAt: paidKgs > 0 ? form.paidAt : null,
      };
      if (editingId) {
        await api(`/purchases/${purchase.id}/logistics/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await api(`/purchases/${purchase.id}/logistics`, {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }
      setOpen(false);
      await onChanged();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить расход');
    } finally {
      setBusy(false);
    }
  }

  async function pay(row: PurchaseLogistics) {
    setBusy(true);
    setError(null);
    try {
      await api(`/purchases/${purchase.id}/logistics/${row.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amountKgs: payAmount,
          paymentAccountId: payAccountId,
          paidAt: payDate,
        }),
      });
      setPayingId(null);
      setPayAmount('');
      await onChanged();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'Не удалось провести оплату');
    } finally {
      setBusy(false);
    }
  }

  const missingWeight = useMemo(
    () =>
      (purchase.items ?? []).some(
        (item) => Number(item.unitWeightKg) <= 0 || Number(item.product?.unitWeightKg) <= 0,
      ),
    [purchase.items],
  );

  return (
    <Card className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">Логистика и транспорт</p>
        <Button type="button" variant="secondary" onClick={startCreate}>
          + Добавить расход
        </Button>
      </div>
      {missingWeight ? (
        <p className="text-sm text-amber-700">Не указан вес товара</p>
      ) : null}
      {error && !open ? <ErrorText error={error} /> : null}

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead>
            <tr className="border-b border-line text-muted">
              <th className="py-2 pr-3">Тип расхода</th>
              <th className="py-2 pr-3">Дата</th>
              <th className="py-2 pr-3">Получатель</th>
              <th className="py-2 pr-3">Сумма</th>
              <th className="py-2 pr-3">Валюта</th>
              <th className="py-2 pr-3">Курс</th>
              <th className="py-2 pr-3">Сумма в сомах</th>
              <th className="py-2 pr-3">Оплачено</th>
              <th className="py-2 pr-3">Долг</th>
              <th className="py-2 pr-3">Статус</th>
              <th className="py-2 pr-3">Счёт оплаты</th>
              <th className="py-2">Действия</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="py-3 text-muted" colSpan={12}>
                  Расходов логистики пока нет
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id} className="border-b border-line align-top">
                  <td className="py-2 pr-3">
                    {LOGISTICS_TYPE_LABELS[row.type as keyof typeof LOGISTICS_TYPE_LABELS] ??
                      row.type}
                  </td>
                  <td className="py-2 pr-3">{formatBusinessDate(row.expenseDate)}</td>
                  <td className="py-2 pr-3">{row.payeeName || '—'}</td>
                  <td className="py-2 pr-3">{originalAmount(row.amount)}</td>
                  <td className="py-2 pr-3">{row.currency}</td>
                  <td className="py-2 pr-3">{row.exchangeRate || '—'}</td>
                  <td className="py-2 pr-3">{moneySom(row.amountKgs)}</td>
                  <td className="py-2 pr-3">{moneySom(row.paidAmountKgs)}</td>
                  <td className="py-2 pr-3">{moneySom(row.remainingAmountKgs)}</td>
                  <td className="py-2 pr-3">
                    <Badge
                      tone={
                        row.status === 'PAID' ? 'green' : row.status === 'PARTIAL' ? 'amber' : 'red'
                      }
                    >
                      {STATUS_LABELS[row.status ?? 'UNPAID']}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3">
                    {row.paymentAccount
                      ? companyAccountLabel({
                          name: row.paymentAccount.name,
                          paymentMethodCode: row.paymentAccount.paymentMethodCode ?? undefined,
                        })
                      : '—'}
                  </td>
                  <td className="py-2">
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        className="text-left text-sm font-semibold text-brand"
                        onClick={() => startEdit(row)}
                      >
                        Изменить
                      </button>
                      {Number(row.remainingAmountKgs) > 0 ? (
                        <button
                          type="button"
                          className="text-left text-sm font-semibold text-brand"
                          onClick={() => {
                            setPayingId(row.id);
                            setPayAmount(row.remainingAmountKgs || '');
                            setError(null);
                          }}
                        >
                          Оплатить
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-3 md:hidden">
        {rows.map((row) => (
          <Card key={row.id} className="space-y-1 text-sm">
            <p className="font-semibold">
              {LOGISTICS_TYPE_LABELS[row.type as keyof typeof LOGISTICS_TYPE_LABELS] ?? row.type}
            </p>
            <p>Дата: {formatBusinessDate(row.expenseDate)}</p>
            <p>Получатель: {row.payeeName || '—'}</p>
            <p>
              Сумма: {originalAmount(row.amount)} {row.currency}
            </p>
            <p>Сумма в сомах: {moneySom(row.amountKgs)}</p>
            <p>Оплачено: {moneySom(row.paidAmountKgs)}</p>
            <p>Остаток долга: {moneySom(row.remainingAmountKgs)}</p>
            <Badge>{STATUS_LABELS[row.status ?? 'UNPAID']}</Badge>
            {Number(row.remainingAmountKgs) > 0 ? (
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setPayingId(row.id);
                  setPayAmount(row.remainingAmountKgs || '');
                }}
              >
                Оплатить
              </Button>
            ) : null}
          </Card>
        ))}
      </div>

      {open ? (
        <div className="space-y-3 rounded-xl border border-line p-3">
          <p className="font-semibold">{editingId ? 'Изменить расход' : 'Новый расход'}</p>
          <Field label="Тип расхода *">
            <Select
              value={form.type}
              onChange={(e) =>
                setForm((s) => ({ ...s, type: e.target.value as LogisticsForm['type'] }))
              }
            >
              {Object.entries(LOGISTICS_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Дата расхода *">
            <Input
              type="date"
              value={form.expenseDate}
              onChange={(e) => setForm((s) => ({ ...s, expenseDate: e.target.value }))}
            />
          </Field>
          <Field label="Получатель / перевозчик">
            <Input
              value={form.payeeName}
              onChange={(e) => setForm((s) => ({ ...s, payeeName: e.target.value }))}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Сумма *">
              <Input
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setForm((s) => ({ ...s, amount: e.target.value }))}
              />
            </Field>
            <Field label="Валюта *">
              <Select
                value={form.currency}
                onChange={(e) =>
                  setForm((s) => ({ ...s, currency: e.target.value as Currency }))
                }
              >
                <option value="KGS">KGS</option>
                <option value="USD">USD</option>
                <option value="CNY">CNY</option>
              </Select>
            </Field>
          </div>
          {form.currency !== 'KGS' ? (
            <Field label={`Курс валюты, KGS/${form.currency}`}>
              <Input
                inputMode="decimal"
                value={form.exchangeRate}
                onChange={(e) => setForm((s) => ({ ...s, exchangeRate: e.target.value }))}
              />
            </Field>
          ) : null}
          <p className="text-sm">
            Сумма в сомах: <span className="font-semibold">{moneySom(computedKgs.toFixed(2))}</span>
          </p>
          <Field label="Комментарий">
            <Textarea
              value={form.comment}
              onChange={(e) => setForm((s) => ({ ...s, comment: e.target.value }))}
            />
          </Field>
          <Field label="Способ расчёта">
            <Select
              value={form.settlement}
              onChange={(e) =>
                setForm((s) => ({ ...s, settlement: e.target.value as Settlement }))
              }
            >
              <option value="PAID">Оплачено полностью</option>
              <option value="PARTIAL">Частично оплачено</option>
              <option value="UNPAID">В долг</option>
            </Select>
          </Field>
          {form.settlement !== 'UNPAID' ? (
            <>
              <Field label="Счёт оплаты">
                <Select
                  value={form.paymentAccountId}
                  onChange={(e) => setForm((s) => ({ ...s, paymentAccountId: e.target.value }))}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {companyAccountLabel(account)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Оплачено">
                <Input
                  inputMode="decimal"
                  value={form.settlement === 'PAID' ? computedKgs.toFixed(2) : form.paidAmountKgs}
                  disabled={form.settlement === 'PAID'}
                  onChange={(e) => setForm((s) => ({ ...s, paidAmountKgs: e.target.value }))}
                />
              </Field>
              <p className="text-sm">Остаток долга: {moneySom(remainingKgs.toFixed(2))}</p>
              <Field label="Дата оплаты">
                <Input
                  type="date"
                  value={form.paidAt}
                  onChange={(e) => setForm((s) => ({ ...s, paidAt: e.target.value }))}
                />
              </Field>
            </>
          ) : (
            <p className="text-sm">Остаток долга: {moneySom(remainingKgs.toFixed(2))}</p>
          )}
          {error ? <ErrorText error={error} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={busy} onClick={() => void save()}>
              Сохранить
            </Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : null}

      {payingId ? (
        <div className="space-y-3 rounded-xl border border-line p-3">
          <p className="font-semibold">Оплатить</p>
          <Field label="Оплачено">
            <Input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
          </Field>
          <Field label="Счёт оплаты">
            <Select value={payAccountId} onChange={(e) => setPayAccountId(e.target.value)}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {companyAccountLabel(account)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Дата оплаты">
            <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </Field>
          {error ? <ErrorText error={error} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              disabled={busy}
              onClick={() => {
                const row = rows.find((item) => item.id === payingId);
                if (row) void pay(row);
              }}
            >
              Оплатить
            </Button>
            <Button type="button" variant="secondary" onClick={() => setPayingId(null)}>
              Отмена
            </Button>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted">
        Эти расходы входят в себестоимость закупки и не относятся к аренде склада, канцтоварам или
        зарплате владельца.
      </p>
    </Card>
  );
}
