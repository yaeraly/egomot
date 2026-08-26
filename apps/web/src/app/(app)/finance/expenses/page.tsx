'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatBusinessDate, money } from '@/lib/format';
import { todayInputValue } from '@/lib/date';
import { Button, Card, ErrorText, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';

interface CompanyAccount {
  id: string;
  name: string;
  paymentMethodCode: string;
}

interface ExpenseRow {
  id: string;
  expenseDate: string;
  category: string;
  amountKgs: string;
  accountCode: string;
  accountName: string;
  description: string;
}

interface WithdrawalRow {
  id: string;
  withdrawnAt: string;
  amountKgs: string;
  description: string | null;
}

const CATEGORIES = [
  ['WAREHOUSE_RENT', 'Warehouse Rent'],
  ['STATIONERY', 'Stationery'],
  ['OWNER_SALARY', 'Owner Salary'],
  ['OTHER', 'Other'],
] as const;

export default function ExpensesPage() {
  const [accounts, setAccounts] = useState<CompanyAccount[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    expenseDate: todayInputValue(),
    category: 'WAREHOUSE_RENT',
    amountKgs: '',
    paymentAccountId: '',
    description: '',
  });
  const [withdrawal, setWithdrawal] = useState({
    withdrawnAt: todayInputValue(),
    amountKgs: '',
    paymentAccountId: '',
    description: '',
  });

  async function load() {
    const [company, expenseRows, withdrawalRows] = await Promise.all([
      api<CompanyAccount[]>('/accounting/company-accounts'),
      api<ExpenseRow[]>('/accounting/operating-expenses'),
      api<WithdrawalRow[]>('/accounting/owner-withdrawals'),
    ]);
    setAccounts(company);
    setExpenses(expenseRows);
    setWithdrawals(withdrawalRows);
    setForm((s) => ({ ...s, paymentAccountId: s.paymentAccountId || company[0]?.id || '' }));
    setWithdrawal((s) => ({ ...s, paymentAccountId: s.paymentAccountId || company[0]?.id || '' }));
  }

  useEffect(() => {
    void load().catch((e: unknown) => {
      setError(e instanceof ApiError ? e.message : 'Не удалось загрузить расходы');
    });
  }, []);

  async function createExpense() {
    setBusy(true);
    setError(null);
    try {
      await api('/accounting/operating-expenses', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      await load();
      setForm((s) => ({ ...s, amountKgs: '', description: '' }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить расход');
    } finally {
      setBusy(false);
    }
  }

  async function createWithdrawal() {
    setBusy(true);
    setError(null);
    try {
      await api('/accounting/owner-withdrawals', {
        method: 'POST',
        body: JSON.stringify(withdrawal),
      });
      await load();
      setWithdrawal((s) => ({ ...s, amountKgs: '', description: '' }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Не удалось сохранить изъятие');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Расходы"
        subtitle="Зарплата владельца уменьшает прибыль. Изъятие капитала — нет."
      />
      <ErrorText error={error} />

      <Card className="space-y-3">
        <p className="font-semibold">Операционный расход</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Дата">
            <Input type="date" value={form.expenseDate} onChange={(e) => setForm((s) => ({ ...s, expenseDate: e.target.value }))} />
          </Field>
          <Field label="Категория">
            <Select value={form.category} onChange={(e) => setForm((s) => ({ ...s, category: e.target.value }))}>
              {CATEGORIES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Сумма">
            <Input inputMode="decimal" value={form.amountKgs} onChange={(e) => setForm((s) => ({ ...s, amountKgs: e.target.value }))} />
          </Field>
          <Field label="Счёт компании">
            <Select value={form.paymentAccountId} onChange={(e) => setForm((s) => ({ ...s, paymentAccountId: e.target.value }))}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Описание">
          <Textarea value={form.description} onChange={(e) => setForm((s) => ({ ...s, description: e.target.value }))} />
        </Field>
        <Button disabled={busy} onClick={() => void createExpense()}>Провести расход</Button>
      </Card>

      <Card className="space-y-3">
        <p className="font-semibold">Изъятие владельца</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Дата">
            <Input type="date" value={withdrawal.withdrawnAt} onChange={(e) => setWithdrawal((s) => ({ ...s, withdrawnAt: e.target.value }))} />
          </Field>
          <Field label="Сумма">
            <Input inputMode="decimal" value={withdrawal.amountKgs} onChange={(e) => setWithdrawal((s) => ({ ...s, amountKgs: e.target.value }))} />
          </Field>
          <Field label="Счёт компании">
            <Select value={withdrawal.paymentAccountId} onChange={(e) => setWithdrawal((s) => ({ ...s, paymentAccountId: e.target.value }))}>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Описание">
          <Input value={withdrawal.description} onChange={(e) => setWithdrawal((s) => ({ ...s, description: e.target.value }))} />
        </Field>
        <Button variant="secondary" disabled={busy} onClick={() => void createWithdrawal()}>
          Провести изъятие
        </Button>
      </Card>

      <div className="space-y-3">
        {expenses.map((row) => (
          <Card key={row.id} className="space-y-1 text-sm">
            <p className="font-semibold">{row.accountName}</p>
            <p>{formatBusinessDate(row.expenseDate)} · {money(row.amountKgs, 'KGS')}</p>
            <p className="text-muted">{row.description}</p>
          </Card>
        ))}
        {withdrawals.map((row) => (
          <Card key={row.id} className="space-y-1 text-sm">
            <p className="font-semibold">Owner Withdrawal</p>
            <p>{formatBusinessDate(row.withdrawnAt)} · {money(row.amountKgs, 'KGS')}</p>
            {row.description ? <p className="text-muted">{row.description}</p> : null}
          </Card>
        ))}
      </div>
    </div>
  );
}
