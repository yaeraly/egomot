'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { todayInputValue } from '@/lib/date';
import { formatBusinessDate, moneySom } from '@/lib/format';
import { Badge, Button, Card, ErrorText, Field, Input, PageHeader, Select } from '@/components/ui';
import { PAYABLE_STATUS_LABELS, companyAccountLabel } from '@/lib/finance-labels';
import { SupplierPaymentModal } from '@/components/SupplierPaymentModal';
import {
  type CompanyPaymentAccount,
  supplierPaymentTargetFromPayable,
} from '@/lib/supplier-payment';

type Tab = 'customer' | 'supplier' | 'logistics';

interface SupplierPayableRow {
  id?: string;
  purchaseId?: string;
  supplierName: string;
  purchaseNumber: string;
  amountKgs: string;
  paidAmountKgs: string;
  remainingAmountKgs: string;
  dueDate: string | null;
  status: string;
}

interface LogisticsDebtRow {
  id: string;
  payableId: string;
  kind: 'CARGO' | 'TRANSPORT';
  type: string;
  payeeName: string | null;
  purchaseId: string;
  purchaseNumber: string;
  expenseDate: string | null;
  currency: string;
  originalAmount: string;
  amountKgs: string;
  paidAmountKgs: string;
  remainingAmountKgs: string;
  status: string;
  canPay: boolean;
}

interface CustomerDebt {
  totalOpenDebtKgs: string;
  sales: Array<{
    saleNumber: string;
    clientName: string;
    originalAmountKgs: string;
    paidAmountKgs: string;
    remainingKgs: string;
  }>;
}

const TYPE_LABELS: Record<string, string> = {
  CARGO: 'Карго Китай → Кыргызстан',
  CHINA_INTERNAL_TRANSPORT: 'Транспорт по Китаю',
  KYRGYZSTAN_INTERNAL_TRANSPORT: 'Транспорт по Кыргызстану',
};

export default function DebtsPage() {
  const [tab, setTab] = useState<Tab>('customer');
  const [supplier, setSupplier] = useState<SupplierPayableRow[]>([]);
  const [logistics, setLogistics] = useState<LogisticsDebtRow[]>([]);
  const [customers, setCustomers] = useState<CustomerDebt | null>(null);
  const [accounts, setAccounts] = useState<CompanyPaymentAccount[]>([]);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payAccountId, setPayAccountId] = useState('');
  const [payDate, setPayDate] = useState(todayInputValue());
  const [supplierPaymentTarget, setSupplierPaymentTarget] =
    useState<ReturnType<typeof supplierPaymentTargetFromPayable>>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [supplierRows, logisticsRows, customerRows, company] = await Promise.all([
      api<SupplierPayableRow[]>('/accounting/supplier-payables'),
      api<LogisticsDebtRow[]>('/accounting/logistics-debts'),
      api<CustomerDebt>('/accounting/receivables'),
      api<CompanyPaymentAccount[]>('/accounting/company-accounts'),
    ]);
    setSupplier(supplierRows);
    setLogistics(logisticsRows);
    setCustomers(customerRows);
    setAccounts(company);
    setPayAccountId((id) => id || company[0]?.id || '');
  }

  useEffect(() => {
    void load();
  }, []);

  async function payLogistics(row: LogisticsDebtRow) {
    setBusy(true);
    setError(null);
    try {
      if (row.kind === 'CARGO' && !row.canPay) {
        await api(`/accounting/cargo-payables/${row.payableId}/payments`, {
          method: 'POST',
          body: JSON.stringify({
            amountKgs: payAmount,
            paymentAccountId: payAccountId,
            paidAt: payDate,
          }),
        });
      } else {
        await api(`/accounting/logistics/${row.id}/payments`, {
          method: 'POST',
          body: JSON.stringify({
            amountKgs: payAmount,
            paymentAccountId: payAccountId,
            paidAt: payDate,
          }),
        });
      }
      setPayingId(null);
      await load();
    } catch (e: unknown) {
      setError(e instanceof ApiError ? e.message : 'Не удалось провести оплату');
    } finally {
      setBusy(false);
    }
  }

  function openSupplierPayment(row: SupplierPayableRow) {
    setSupplierPaymentTarget(supplierPaymentTargetFromPayable(row));
  }

  function supplierRowKey(row: SupplierPayableRow, index: number) {
    return row.id ?? `${row.purchaseNumber}-${index}`;
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Долги" subtitle="Клиенты, поставщики, карго и транспорт" />
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['customer', 'Клиенты'],
            ['supplier', 'Поставщики'],
            ['logistics', 'Карго и транспорт'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${
              tab === key ? 'bg-brand text-white' : 'border border-line bg-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'supplier' ? (
        <div className="space-y-3">
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2 pr-3">Поставщик</th>
                  <th className="py-2 pr-3">Закупка</th>
                  <th className="py-2 pr-3">Сумма</th>
                  <th className="py-2 pr-3">Оплачено</th>
                  <th className="py-2 pr-3">Остаток</th>
                  <th className="py-2 pr-3">Статус</th>
                  <th className="py-2 pr-3">Срок оплаты</th>
                  <th className="py-2">Действия</th>
                </tr>
              </thead>
              <tbody>
                {supplier.length === 0 ? (
                  <tr>
                    <td className="py-3 text-muted" colSpan={8}>
                      Нет долгов поставщикам
                    </td>
                  </tr>
                ) : (
                  supplier.map((row, index) => (
                    <tr key={supplierRowKey(row, index)} className="border-b border-line align-top">
                      <td className="py-2 pr-3 font-semibold">{row.supplierName}</td>
                      <td className="py-2 pr-3">{row.purchaseNumber}</td>
                      <td className="py-2 pr-3">{moneySom(row.amountKgs)}</td>
                      <td className="py-2 pr-3">{moneySom(row.paidAmountKgs)}</td>
                      <td className="py-2 pr-3">{moneySom(row.remainingAmountKgs)}</td>
                      <td className="py-2 pr-3">
                        <Badge>{PAYABLE_STATUS_LABELS[row.status] ?? row.status}</Badge>
                      </td>
                      <td className="py-2 pr-3">
                        {row.dueDate ? formatBusinessDate(row.dueDate) : '—'}
                      </td>
                      <td className="py-2">
                        {Number(row.remainingAmountKgs) > 0 && row.purchaseId ? (
                          <Button
                            variant="secondary"
                            className="min-h-10 px-3"
                            onClick={() => openSupplierPayment(row)}
                          >
                            Оплатить
                          </Button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {supplier.map((row, index) => (
              <Card key={supplierRowKey(row, index)} className="space-y-1 text-sm">
                <div className="flex justify-between gap-2">
                  <p className="font-semibold">{row.supplierName}</p>
                  <Badge>{PAYABLE_STATUS_LABELS[row.status] ?? row.status}</Badge>
                </div>
                <p className="text-muted">Закупка: {row.purchaseNumber}</p>
                <p>Сумма: {moneySom(row.amountKgs)}</p>
                <p>Оплачено: {moneySom(row.paidAmountKgs)}</p>
                <p>Остаток: {moneySom(row.remainingAmountKgs)}</p>
                {row.dueDate ? <p>Срок: {formatBusinessDate(row.dueDate)}</p> : null}
                {Number(row.remainingAmountKgs) > 0 && row.purchaseId ? (
                  <Button variant="secondary" className="mt-2" onClick={() => openSupplierPayment(row)}>
                    Оплатить
                  </Button>
                ) : null}
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      {tab === 'logistics' ? (
        <div className="space-y-3">
          <ErrorText error={error} />
          {logistics.map((row) => (
            <Card key={`${row.kind}-${row.payableId}`} className="space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <p className="font-semibold">{row.payeeName || 'Получатель не указан'}</p>
                <Badge>{PAYABLE_STATUS_LABELS[row.status] ?? row.status}</Badge>
              </div>
              <p>Тип: {TYPE_LABELS[row.type] ?? row.type}</p>
              <p className="text-muted">Закупка: {row.purchaseNumber}</p>
              {row.expenseDate ? <p>Дата: {formatBusinessDate(row.expenseDate)}</p> : null}
              <p>
                Валюта: {row.currency} · Исходная сумма: {row.originalAmount}
              </p>
              <p>Сумма в сомах: {moneySom(row.amountKgs)}</p>
              <p>Оплачено: {moneySom(row.paidAmountKgs)}</p>
              <p>Остаток: {moneySom(row.remainingAmountKgs)}</p>
              {Number(row.remainingAmountKgs) > 0 ? (
                payingId === row.id ? (
                  <div className="space-y-2 pt-2">
                    <Field label="Оплатить">
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
                    <div className="flex gap-2">
                      <Button disabled={busy} onClick={() => void payLogistics(row)}>
                        Оплатить
                      </Button>
                      <Button variant="secondary" onClick={() => setPayingId(null)}>
                        Отмена
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    className="mt-2"
                    variant="secondary"
                    onClick={() => {
                      setPayingId(row.id);
                      setPayAmount(row.remainingAmountKgs);
                      setError(null);
                    }}
                  >
                    Оплатить
                  </Button>
                )
              ) : null}
            </Card>
          ))}
        </div>
      ) : null}

      {tab === 'customer' ? (
        <div className="space-y-3">
          <Card>
            <p className="text-sm text-muted">Всего долга клиентов</p>
            <p className="text-2xl font-bold">{moneySom(customers?.totalOpenDebtKgs)}</p>
          </Card>
          {customers?.sales.map((row) => (
            <Card key={row.saleNumber} className="space-y-1 text-sm">
              <p className="font-semibold">{row.clientName}</p>
              <p className="text-muted">{row.saleNumber}</p>
              <p>Сумма: {moneySom(row.originalAmountKgs)}</p>
              <p>Оплачено: {moneySom(row.paidAmountKgs)}</p>
              <p>Остаток: {moneySom(row.remainingKgs)}</p>
            </Card>
          ))}
        </div>
      ) : null}

      {tab === 'logistics' && logistics.length === 0 ? (
        <Card><p className="text-sm text-muted">Нет долгов за карго и транспорт</p></Card>
      ) : null}

      <SupplierPaymentModal
        open={supplierPaymentTarget !== null}
        target={supplierPaymentTarget}
        accounts={accounts}
        onClose={() => setSupplierPaymentTarget(null)}
        onSuccess={load}
      />
    </div>
  );
}
