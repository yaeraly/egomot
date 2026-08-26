'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatBusinessDate, moneySom } from '@/lib/format';
import { Badge, Button, Card, ErrorText, PageHeader } from '@/components/ui';
import { PAYABLE_STATUS_LABELS } from '@/lib/finance-labels';
import { SupplierPaymentModal } from '@/components/SupplierPaymentModal';
import { PayablePaymentModal } from '@/components/PayablePaymentModal';
import {
  type CompanyPaymentAccount,
  type PayablePaymentTarget,
  supplierPaymentTargetFromPayable,
} from '@/lib/supplier-payment';

type Tab = 'customer' | 'supplier' | 'cargo' | 'transport';
type StatusFilter = 'OPEN' | 'ALL' | 'UNPAID' | 'PARTIAL' | 'PAID';

interface SupplierPayableRow {
  id?: string;
  purchaseId?: string;
  supplierName: string;
  purchaseNumber: string;
  purchaseDate?: string | null;
  amountKgs: string;
  paidAmountKgs: string;
  remainingAmountKgs: string;
  dueDate: string | null;
  status: string;
}

interface SupplierPayablesResponse {
  remainingKgs: string;
  glRemainingKgs: string;
  differenceKgs: string;
  rows: SupplierPayableRow[];
}

interface LogisticsDebtRow {
  id: string;
  payableId: string;
  kind: 'CARGO' | 'TRANSPORT';
  type: string;
  payeeName: string | null;
  purchaseId: string;
  purchaseNumber: string;
  purchaseDate?: string | null;
  expenseDate: string | null;
  currency: string;
  originalAmount: string;
  amountKgs: string;
  paidAmountKgs: string;
  remainingAmountKgs: string;
  status: string;
  canPay: boolean;
  payPath?: 'LOGISTICS' | 'CARGO_PAYABLE' | 'TRANSPORT_PAYABLE';
}

interface LogisticsDebtsResponse {
  cargoRemainingKgs: string;
  transportRemainingKgs: string;
  remainingKgs: string;
  glCargoRemainingKgs: string;
  glTransportRemainingKgs: string;
  rows: LogisticsDebtRow[];
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

const FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'OPEN', label: 'Текущие долги' },
  { key: 'UNPAID', label: 'Не оплачено' },
  { key: 'PARTIAL', label: 'Частично оплачено' },
  { key: 'PAID', label: 'Оплачено' },
  { key: 'ALL', label: 'Все' },
];

export default function DebtsPage() {
  const [tab, setTab] = useState<Tab>('customer');
  const [filter, setFilter] = useState<StatusFilter>('OPEN');
  const [supplier, setSupplier] = useState<SupplierPayableRow[]>([]);
  const [supplierTotal, setSupplierTotal] = useState('0.00');
  const [logistics, setLogistics] = useState<LogisticsDebtRow[]>([]);
  const [cargoTotal, setCargoTotal] = useState('0.00');
  const [transportTotal, setTransportTotal] = useState('0.00');
  const [customers, setCustomers] = useState<CustomerDebt | null>(null);
  const [accounts, setAccounts] = useState<CompanyPaymentAccount[]>([]);
  const [supplierPaymentTarget, setSupplierPaymentTarget] =
    useState<ReturnType<typeof supplierPaymentTargetFromPayable>>(null);
  const [logisticsTarget, setLogisticsTarget] = useState<PayablePaymentTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    const query = `?filter=${filter}`;
    const results = await Promise.allSettled([
      api<SupplierPayablesResponse | SupplierPayableRow[]>(`/accounting/supplier-payables${query}`),
      api<LogisticsDebtsResponse | LogisticsDebtRow[]>(`/accounting/logistics-debts${query}`),
      api<CustomerDebt>('/accounting/receivables'),
      api<CompanyPaymentAccount[]>('/accounting/company-accounts'),
    ]);

    const failures: string[] = [];
    const supplierResult = results[0];
    if (supplierResult.status === 'fulfilled') {
      const payload = supplierResult.value;
      if (Array.isArray(payload)) {
        setSupplier(payload);
        setSupplierTotal(
          payload
            .reduce((sum, row) => sum + Math.max(0, Number(row.remainingAmountKgs)), 0)
            .toFixed(2),
        );
      } else {
        setSupplier(payload.rows);
        setSupplierTotal(payload.remainingKgs);
      }
    } else {
      setSupplier([]);
      failures.push(
        supplierResult.reason instanceof ApiError
          ? supplierResult.reason.message
          : 'Не удалось загрузить долги поставщикам',
      );
    }

    const logisticsResult = results[1];
    if (logisticsResult.status === 'fulfilled') {
      const payload = logisticsResult.value;
      if (Array.isArray(payload)) {
        setLogistics(payload);
        setCargoTotal(
          payload
            .filter((row) => row.kind === 'CARGO')
            .reduce((sum, row) => sum + Math.max(0, Number(row.remainingAmountKgs)), 0)
            .toFixed(2),
        );
        setTransportTotal(
          payload
            .filter((row) => row.kind === 'TRANSPORT')
            .reduce((sum, row) => sum + Math.max(0, Number(row.remainingAmountKgs)), 0)
            .toFixed(2),
        );
      } else {
        setLogistics(payload.rows);
        setCargoTotal(payload.cargoRemainingKgs);
        setTransportTotal(payload.transportRemainingKgs);
      }
    } else {
      setLogistics([]);
      failures.push(
        logisticsResult.reason instanceof ApiError
          ? logisticsResult.reason.message
          : 'Не удалось загрузить долги за карго и транспорт',
      );
    }

    const customersResult = results[2];
    if (customersResult.status === 'fulfilled') {
      setCustomers(customersResult.value);
    }

    const accountsResult = results[3];
    if (accountsResult.status === 'fulfilled') {
      setAccounts(accountsResult.value);
    }

    if (failures.length) setError(failures.join('\n'));
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  function openSupplierPayment(row: SupplierPayableRow) {
    setSupplierPaymentTarget(supplierPaymentTargetFromPayable(row));
  }

  function openLogisticsPayment(row: LogisticsDebtRow) {
    setLogisticsTarget({
      kind: row.kind,
      purchaseId: row.purchaseId,
      supplierName: row.payeeName || 'Получатель не указан',
      purchaseNumber: row.purchaseNumber,
      amountKgs: row.amountKgs,
      paidAmountKgs: row.paidAmountKgs,
      remainingAmountKgs: row.remainingAmountKgs,
      payableId: row.payableId,
      expenseId: row.payPath === 'LOGISTICS' ? row.id : null,
      payPath: row.payPath ?? (row.kind === 'CARGO' ? 'CARGO_PAYABLE' : 'TRANSPORT_PAYABLE'),
    });
  }

  function supplierRowKey(row: SupplierPayableRow, index: number) {
    return row.id ?? `${row.purchaseNumber}-${index}`;
  }

  const visibleLogistics = logistics.filter((row) =>
    tab === 'cargo' ? row.kind === 'CARGO' : row.kind === 'TRANSPORT',
  );
  const logisticsKindLabel = tab === 'cargo' ? 'карго' : 'транспорт';

  return (
    <div className="space-y-4">
      <PageHeader title="Долги" subtitle="Клиенты, поставщики, карго и транспорт — раздельно" />
      <ErrorText error={error} />
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['customer', 'Клиенты'],
            ['supplier', 'Поставщики'],
            ['cargo', 'Карго'],
            ['transport', 'Транспорт'],
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

      {tab !== 'customer' ? (
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              onClick={() => setFilter(item.key)}
              className={`min-h-10 rounded-xl px-3 text-sm font-semibold ${
                filter === item.key ? 'bg-brand text-white' : 'border border-line bg-white'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {tab === 'supplier' ? (
        <div className="space-y-3">
          <Card>
            <p className="text-sm text-muted">Долг поставщикам</p>
            <p className="text-2xl font-bold">{moneySom(supplierTotal)}</p>
          </Card>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2 pr-3">Поставщик</th>
                  <th className="py-2 pr-3">Закупка</th>
                  <th className="py-2 pr-3">Дата</th>
                  <th className="py-2 pr-3">Общая сумма</th>
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
                    <td className="py-3 text-muted" colSpan={9}>
                      Нет долгов поставщикам
                    </td>
                  </tr>
                ) : (
                  supplier.map((row, index) => (
                    <tr key={supplierRowKey(row, index)} className="border-b border-line align-top">
                      <td className="py-2 pr-3 font-semibold">{row.supplierName}</td>
                      <td className="py-2 pr-3">{row.purchaseNumber}</td>
                      <td className="py-2 pr-3">
                        {row.purchaseDate ? formatBusinessDate(row.purchaseDate) : '—'}
                      </td>
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
                {row.purchaseDate ? <p>Дата: {formatBusinessDate(row.purchaseDate)}</p> : null}
                <p>Общая сумма: {moneySom(row.amountKgs)}</p>
                <p>Оплачено: {moneySom(row.paidAmountKgs)}</p>
                <p>Остаток: {moneySom(row.remainingAmountKgs)}</p>
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

      {tab === 'cargo' || tab === 'transport' ? (
        <div className="space-y-3">
          <Card>
            <p className="text-sm text-muted">
              {tab === 'cargo' ? 'Долг за карго' : 'Долг за транспорт'}
            </p>
            <p className="text-2xl font-bold">
              {moneySom(tab === 'cargo' ? cargoTotal : transportTotal)}
            </p>
          </Card>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-muted">
                  <th className="py-2 pr-3">Получатель</th>
                  <th className="py-2 pr-3">Тип</th>
                  <th className="py-2 pr-3">Закупка</th>
                  <th className="py-2 pr-3">Дата</th>
                  <th className="py-2 pr-3">Исходная валюта</th>
                  <th className="py-2 pr-3">Исходная сумма</th>
                  <th className="py-2 pr-3">Сумма в сомах</th>
                  <th className="py-2 pr-3">Оплачено</th>
                  <th className="py-2 pr-3">Остаток</th>
                  <th className="py-2 pr-3">Статус</th>
                  <th className="py-2">Действия</th>
                </tr>
              </thead>
              <tbody>
                {visibleLogistics.length === 0 ? (
                  <tr>
                    <td className="py-3 text-muted" colSpan={11}>
                      Нет долгов за {logisticsKindLabel}
                    </td>
                  </tr>
                ) : (
                  visibleLogistics.map((row) => (
                    <tr key={`${row.kind}-${row.payableId}`} className="border-b border-line align-top">
                      <td className="py-2 pr-3 font-semibold">{row.payeeName || 'Получатель не указан'}</td>
                      <td className="py-2 pr-3">{TYPE_LABELS[row.type] ?? row.type}</td>
                      <td className="py-2 pr-3">{row.purchaseNumber}</td>
                      <td className="py-2 pr-3">
                        {row.expenseDate ? formatBusinessDate(row.expenseDate) : '—'}
                      </td>
                      <td className="py-2 pr-3">{row.currency}</td>
                      <td className="py-2 pr-3">{row.originalAmount}</td>
                      <td className="py-2 pr-3">{moneySom(row.amountKgs)}</td>
                      <td className="py-2 pr-3">{moneySom(row.paidAmountKgs)}</td>
                      <td className="py-2 pr-3">{moneySom(row.remainingAmountKgs)}</td>
                      <td className="py-2 pr-3">
                        <Badge>{PAYABLE_STATUS_LABELS[row.status] ?? row.status}</Badge>
                      </td>
                      <td className="py-2">
                        {Number(row.remainingAmountKgs) > 0 ? (
                          <Button
                            variant="secondary"
                            className="min-h-10 px-3"
                            onClick={() => openLogisticsPayment(row)}
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
            {visibleLogistics.map((row) => (
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
                  <Button variant="secondary" className="mt-2" onClick={() => openLogisticsPayment(row)}>
                    Оплатить
                  </Button>
                ) : null}
              </Card>
            ))}
          </div>
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

      <SupplierPaymentModal
        open={supplierPaymentTarget !== null}
        target={supplierPaymentTarget}
        accounts={accounts}
        onClose={() => setSupplierPaymentTarget(null)}
        onSuccess={load}
      />
      <PayablePaymentModal
        open={logisticsTarget !== null}
        target={logisticsTarget}
        accounts={accounts}
        onClose={() => setLogisticsTarget(null)}
        onSuccess={load}
      />
    </div>
  );
}
