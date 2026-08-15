'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, assetUrl } from '@/lib/api';
import { money, weight } from '@/lib/format';
import { Client, PriceCalculation, Product } from '@/lib/types';
import { PriceBreakdown } from '@/components/PriceBreakdown';
import { Badge, Button, Card, Field, PageHeader, Select } from '@/components/ui';

export default function ProductViewPage() {
  const { id } = useParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState('');
  const [price, setPrice] = useState<PriceCalculation | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

  useEffect(() => {
    void api<Product>(`/products/${id}`).then(setProduct);
    void api<Client[]>('/clients?active=true').then(setClients);
  }, [id]);

  async function calculatePrice() {
    if (!clientId) return;
    setPriceError(null);
    try {
      const result = await api<PriceCalculation>('/pricing/calculate', {
        method: 'POST',
        body: JSON.stringify({ productId: id, clientId }),
      });
      setPrice(result);
    } catch {
      setPriceError('Не удалось рассчитать цену. Проверьте остаток на складе и настройки ценообразования.');
      setPrice(null);
    }
  }

  if (!product) return <p className="text-muted">Загрузка…</p>;

  async function deactivate() {
    const updated = await api<Product>(`/products/${id}/deactivate`, { method: 'POST' });
    setProduct(updated);
  }

  return (
    <div>
      <PageHeader
        title={product.name}
        subtitle={product.code}
        action={
          <Link href={`/products/${id}/edit`} className="inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white">
            Изменить
          </Link>
        }
      />
      <Card className="mb-4 space-y-3">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={assetUrl(product.imageUrl) ?? ''} alt="" className="h-48 w-full rounded-xl object-cover" />
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Badge tone={product.isActive ? 'green' : 'slate'}>{product.isActive ? 'Активен' : 'Неактивен'}</Badge>
          <Badge>{product.category.name}</Badge>
        </div>
        <p>Единица: {product.unit}</p>
        <p>Вес: {weight(product.unitWeightKg)}</p>
        <p>Цена CNY: {product.defaultPurchasePriceCny ? money(product.defaultPurchasePriceCny, 'CNY') : '—'}</p>
        <p>Базовая наценка: {product.baseMarkupPercent ? `${product.baseMarkupPercent}%` : '—'}</p>
        {product.isActive ? (
          <Button variant="secondary" onClick={() => void deactivate()}>
            Деактивировать
          </Button>
        ) : null}
      </Card>

      <Card className="space-y-4">
        <h2 className="font-semibold">Расчёт цены для клиента</h2>
        <Field label="Клиент">
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Выберите клиента</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button disabled={!clientId} onClick={() => void calculatePrice()}>
          Рассчитать цену
        </Button>
        {priceError ? <p className="text-sm text-danger">{priceError}</p> : null}
        {price ? <PriceBreakdown data={price} /> : null}
      </Card>
    </div>
  );
}
