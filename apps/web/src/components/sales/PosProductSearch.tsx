'use client';

import { useMemo } from 'react';
import { Product } from '@/lib/types';
import { money } from '@/lib/format';
import { Field, SearchBox, cn } from '@/components/ui';

type Props = {
  products: Product[];
  stock: Record<string, string>;
  search: string;
  onSearchChange: (value: string) => void;
  onSelect: (product: Product) => void;
  clientSelected: boolean;
};

export function PosProductSearch({
  products,
  stock,
  search,
  onSearchChange,
  onSelect,
  clientSelected,
}: Props) {
  const results = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? products.filter((p) => {
          const category = p.category?.name?.toLowerCase() ?? '';
          return (
            p.name.toLowerCase().includes(q) ||
            p.code.toLowerCase().includes(q) ||
            category.includes(q)
          );
        })
      : products;
    return list.slice(0, 30);
  }, [products, search]);

  return (
    <div className="space-y-2">
      <Field label="Поиск товара">
        <SearchBox
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Название, код или категория"
          autoComplete="off"
          disabled={!clientSelected}
        />
      </Field>
      {!clientSelected ? (
        <p className="text-sm text-muted">Сначала выберите клиента — цена зависит от типа и категории.</p>
      ) : null}
      {clientSelected ? (
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line bg-white">
          {results.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted">
              {search.trim() ? 'Товары не найдены' : 'Нет активных товаров'}
            </p>
          ) : (
            results.map((product) => {
              const qty = stock[product.id] ?? '0';
              const outOfStock = Number(qty) <= 0;
              return (
                <button
                  key={product.id}
                  type="button"
                  disabled={outOfStock}
                  onClick={() => onSelect(product)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 border-b border-line px-3 py-2.5 text-left last:border-b-0',
                    outOfStock ? 'cursor-not-allowed opacity-50' : 'hover:bg-page',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{product.name}</span>
                    <span className="text-xs text-muted">
                      {product.code}
                      {product.category?.name ? ` · ${product.category.name}` : ''}
                    </span>
                  </span>
                  <span className={cn('shrink-0 text-xs', outOfStock ? 'text-danger' : 'text-muted')}>
                    {outOfStock ? 'Нет на складе' : `Остаток: ${qty}`}
                  </span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
      {clientSelected && !search.trim() && results.length > 0 ? (
        <p className="text-xs text-muted">Введите запрос или выберите из списка ({results.length})</p>
      ) : null}
    </div>
  );
}
