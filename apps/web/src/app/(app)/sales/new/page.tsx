'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { money } from '@/lib/format';
import {
  Client,
  ClientCard,
  InventoryStock,
  PaymentAccount,
  Product,
  Sale,
  SalePreview,
} from '@/lib/types';
import { PosCustomerSearch } from '@/components/sales/PosCustomerSearch';
import { PosPaymentSelector } from '@/components/sales/PosPaymentSelector';
import { PosProductSearch } from '@/components/sales/PosProductSearch';
import { Button, Card, ErrorText, Field, Input, PageHeader } from '@/components/ui';

type CartLine = {
  productId: string;
  product: Product;
  quantity: string;
  unitPriceKgs: string;
  lineTotalKgs: string;
};

export default function PosPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Record<string, string>>({});
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [clientId, setClientId] = useState('');
  const [clientCard, setClientCard] = useState<ClientCard | null>(null);
  const [productSearch, setProductSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payments, setPayments] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void Promise.all([
      api<Client[]>('/clients?active=true'),
      api<Product[]>('/products?active=true'),
      api<InventoryStock[]>('/inventory'),
      api<PaymentAccount[]>('/finance/my-accounts'),
    ]).then(([c, p, s, a]) => {
      setClients(c);
      setProducts(p);
      setAccounts(a);
      const map: Record<string, string> = {};
      for (const row of s) map[row.productId] = row.quantity;
      setStock(map);
      const initial: Record<string, string> = {};
      for (const acc of a) initial[acc.id] = '';
      setPayments(initial);
    });
  }, []);

  useEffect(() => {
    if (!clientId) {
      setClientCard(null);
      return;
    }
    void api<ClientCard>(`/clients/${clientId}/card`).then(setClientCard);
  }, [clientId]);

  const totalAmount = useMemo(
    () => cart.reduce((sum, line) => sum + Number(line.lineTotalKgs || 0), 0),
    [cart],
  );

  const paidAmount = useMemo(
    () => Object.values(payments).reduce((sum, v) => sum + (Number(v) || 0), 0),
    [payments],
  );

  const debtAmount = Math.max(0, totalAmount - paidAmount);
  const previousDebt = Number(clientCard?.debt?.currentDebtKgs ?? 0);
  const projectedTotalDebt = previousDebt + debtAmount;

  function clearClient() {
    setClientId('');
    setClientCard(null);
    setCart([]);
    setProductSearch('');
  }

  async function addProduct(product: Product) {
    if (!clientId) {
      setError('Сначала выберите клиента');
      return;
    }
    setError(null);
    try {
      const preview = await api<SalePreview>('/sales/preview', {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          items: [{ productId: product.id, quantity: '1' }],
        }),
      });
      const line = preview.items[0];
      setCart((prev) => {
        const existing = prev.find((row) => row.productId === product.id);
        if (existing) {
          return prev.map((row) =>
            row.productId === product.id
              ? {
                  ...row,
                  quantity: String(Number(row.quantity) + 1),
                  unitPriceKgs: line.unitPriceKgs,
                  lineTotalKgs: String(Number(line.unitPriceKgs) * (Number(row.quantity) + 1)),
                }
              : row,
          );
        }
        return [
          ...prev,
          {
            productId: product.id,
            product,
            quantity: '1',
            unitPriceKgs: line.unitPriceKgs,
            lineTotalKgs: line.unitPriceKgs,
          },
        ];
      });
      setProductSearch('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось рассчитать цену');
    }
  }

  async function updateQuantity(productId: string, quantity: string) {
    if (!clientId) return;
    const qty = quantity || '1';
    try {
      const preview = await api<SalePreview>('/sales/preview', {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          items: [{ productId, quantity: qty }],
        }),
      });
      const line = preview.items[0];
      setCart((prev) =>
        prev.map((row) =>
          row.productId === productId
            ? {
                ...row,
                quantity: qty,
                unitPriceKgs: line.unitPriceKgs,
                lineTotalKgs: line.lineTotalKgs,
              }
            : row,
        ),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось пересчитать цену');
    }
  }

  async function confirmSale() {
    if (!clientId || cart.length === 0) {
      setError('Выберите клиента и добавьте товары');
      return;
    }
    if (paidAmount > totalAmount + 0.0001) {
      setError('Сумма оплат превышает сумму продажи');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const paymentEntries = accounts
        .map((acc) => ({
          paymentAccountId: acc.id,
          amountKgs: payments[acc.id] || '0',
        }))
        .filter((p) => Number(p.amountKgs) > 0);

      const sale = await api<Sale>('/sales/confirm', {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          idempotencyKey: crypto.randomUUID(),
          items: cart.map((line) => ({
            productId: line.productId,
            quantity: line.quantity,
          })),
          payments: paymentEntries,
        }),
      });
      router.push(`/sales/${sale.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось подтвердить продажу');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Новая продажа"
        subtitle="POS"
        action={<Link href="/sales" className="text-sm text-brand">← К списку</Link>}
      />

      <Card className="mb-4 space-y-3">
        <PosCustomerSearch
          clients={clients}
          clientId={clientId}
          onSelect={setClientId}
          onClear={clearClient}
        />
        {clientCard ? (
          <div className="rounded-xl bg-page p-3 text-sm">
            <p>Тип: {clientCard.pricing.clientTypeLabel}</p>
            <p>Категория: {clientCard.pricing.clientCategoryLabel}</p>
            <p>Покупки за 90 дней: {money(clientCard.pricing.paidPurchaseAmount90DaysKgs)}</p>
            <p className="font-medium text-amber-700">
              Текущий долг: {money(clientCard.debt?.currentDebtKgs ?? '0')}
            </p>
          </div>
        ) : null}
      </Card>

      <Card className="mb-4">
        <PosProductSearch
          products={products}
          stock={stock}
          search={productSearch}
          onSearchChange={setProductSearch}
          onSelect={(product) => void addProduct(product)}
          clientSelected={Boolean(clientId)}
        />
      </Card>

      <Card className="mb-4 space-y-3">
        <h2 className="font-semibold">Корзина</h2>
        {cart.length === 0 ? <p className="text-sm text-muted">Добавьте товары из поиска</p> : null}
        {cart.map((line) => (
          <div key={line.productId} className="rounded-xl border border-line p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-medium">{line.product.name}</p>
                <p className="text-xs text-muted">{line.product.code}</p>
              </div>
              <button
                type="button"
                className="text-sm text-danger"
                onClick={() => setCart((prev) => prev.filter((r) => r.productId !== line.productId))}
              >
                Удалить
              </button>
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
              <Field label="Кол-во">
                <Input
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(e) => void updateQuantity(line.productId, e.target.value)}
                />
              </Field>
              <p className="self-end pb-3">Цена: {money(line.unitPriceKgs)}</p>
              <p className="self-end pb-3 font-semibold">Итого: {money(line.lineTotalKgs)}</p>
            </div>
          </div>
        ))}
        <p className="text-lg font-bold">ИТОГО: {money(String(totalAmount))}</p>
      </Card>

      <Card className="mb-4 space-y-3">
        <h2 className="font-semibold">Оплата</h2>
        <PosPaymentSelector
          accounts={accounts}
          payments={payments}
          onPaymentsChange={setPayments}
          totalAmount={totalAmount}
          paidAmount={paidAmount}
          debtAmount={debtAmount}
        />
        {clientId ? (
          <p className="font-semibold text-amber-800">
            Общий долг клиента после продажи: {money(String(projectedTotalDebt))}
          </p>
        ) : null}
      </Card>

      <ErrorText error={error} />
      <Button disabled={busy || !clientId || cart.length === 0} onClick={() => void confirmSale()} className="w-full">
        {busy ? 'Подтверждение…' : 'ПОДТВЕРДИТЬ ПРОДАЖУ'}
      </Button>
    </div>
  );
}
