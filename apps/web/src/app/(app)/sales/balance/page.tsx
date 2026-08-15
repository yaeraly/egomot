'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/format';
import { EmployeeBalance } from '@/lib/types';
import { Card, PageHeader } from '@/components/ui';

export default function SalesBalancePage() {
  const [balance, setBalance] = useState<EmployeeBalance | null>(null);

  useEffect(() => {
    void api<EmployeeBalance>('/finance/my-balance').then(setBalance);
  }, []);

  if (!balance) return <p className="text-muted">Загрузка…</p>;

  return (
    <div>
      <PageHeader title="Мой баланс" subtitle="По платёжным счетам" />
      <Card className="mb-4">
        <p className="text-sm text-muted">Общий баланс</p>
        <p className="text-2xl font-bold">{money(balance.totalBalanceKgs)}</p>
      </Card>
      <div className="space-y-3">
        {balance.accounts.map((account) => (
          <Card key={account.accountId} className="flex items-center justify-between">
            <div>
              <p className="font-medium">{account.paymentMethodName}</p>
              <p className="text-sm text-muted">{account.accountName}</p>
            </div>
            <p className="font-semibold">{money(account.balanceKgs)}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
