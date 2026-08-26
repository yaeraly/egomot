'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatBusinessDate, moneySom } from '@/lib/format';
import { Badge, Card, PageHeader } from '@/components/ui';
import { PAYABLE_STATUS_LABELS } from '@/lib/finance-labels';

type Tab = 'supplier' | 'cargo' | 'customer';

interface SupplierPayableRow {
  supplierName: string;
  purchaseNumber: string;
  amountKgs: string;
  paidAmountKgs: string;
  remainingAmountKgs: string;
  dueDate: string | null;
  status: string;
}

interface CargoPayableRow {
  cargoVendorName: string | null;
  purchaseNumber: string;
  amountKgs: string;
  paidAmountKgs: string;
  remainingAmountKgs: string;
  status: string;
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

export default function DebtsPage() {
  const [tab, setTab] = useState<Tab>('supplier');
  const [supplier, setSupplier] = useState<SupplierPayableRow[]>([]);
  const [cargo, setCargo] = useState<CargoPayableRow[]>([]);
  const [customers, setCustomers] = useState<CustomerDebt | null>(null);

  useEffect(() => {
    void api<SupplierPayableRow[]>('/accounting/supplier-payables').then(setSupplier);
    void api<CargoPayableRow[]>('/accounting/cargo-payables').then(setCargo);
    void api<CustomerDebt>('/accounting/receivables').then(setCustomers);
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader title="Долги" subtitle="Поставщики, карго и покупатели" />
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['supplier', 'Поставщики'],
            ['cargo', 'Карго'],
            ['customer', 'Покупатели'],
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

      {tab === 'supplier'
        ? supplier.map((row, index) => (
            <Card key={`${row.purchaseNumber}-${index}`} className="space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <p className="font-semibold">{row.supplierName}</p>
                <Badge>{PAYABLE_STATUS_LABELS[row.status] ?? row.status}</Badge>
              </div>
              <p className="text-muted">{row.purchaseNumber}</p>
              <p>Сумма: {moneySom(row.amountKgs)}</p>
              <p>Оплачено: {moneySom(row.paidAmountKgs)}</p>
              <p>Остаток: {moneySom(row.remainingAmountKgs)}</p>
              {row.dueDate ? <p>Срок: {formatBusinessDate(row.dueDate)}</p> : null}
            </Card>
          ))
        : null}

      {tab === 'cargo'
        ? cargo.map((row, index) => (
            <Card key={`${row.purchaseNumber}-${index}`} className="space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <p className="font-semibold">{row.cargoVendorName ?? 'Карго'}</p>
                <Badge>{PAYABLE_STATUS_LABELS[row.status] ?? row.status}</Badge>
              </div>
              <p className="text-muted">{row.purchaseNumber}</p>
              <p>Карго: {moneySom(row.amountKgs)}</p>
              <p>Оплачено: {moneySom(row.paidAmountKgs)}</p>
              <p>Остаток: {moneySom(row.remainingAmountKgs)}</p>
            </Card>
          ))
        : null}

      {tab === 'customer' ? (
        <div className="space-y-3">
          <Card>
            <p className="text-sm text-muted">Всего долга покупателей</p>
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

      {tab === 'supplier' && supplier.length === 0 ? (
        <Card><p className="text-sm text-muted">Нет долгов поставщикам</p></Card>
      ) : null}
      {tab === 'cargo' && cargo.length === 0 ? (
        <Card><p className="text-sm text-muted">Нет долгов карго</p></Card>
      ) : null}
    </div>
  );
}
