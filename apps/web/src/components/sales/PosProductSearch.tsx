'use client';

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Product } from '@/lib/types';
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
  const [highlightIndex, setHighlightIndex] = useState(0);

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

  useEffect(() => {
    setHighlightIndex(0);
  }, [search, results.length]);

  function selectProduct(product: Product) {
    const qty = stock[product.id] ?? '0';
    if (Number(qty) <= 0) return;
    onSelect(product);
  }

  function onSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!clientSelected || results.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIndex((prev) => (prev + 1) % results.length);
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIndex((prev) => (prev - 1 + results.length) % results.length);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const product = results[highlightIndex] ?? results[0];
      if (product) selectProduct(product);
    }
  }

  return (
    <div className="space-y-2">
      <Field label="Поиск товара">
        <SearchBox
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={onSearchKeyDown}
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
            results.map((product, index) => {
              const qty = stock[product.id] ?? '0';
              const outOfStock = Number(qty) <= 0;
              return (
                <button
                  key={product.id}
                  type="button"
                  disabled={outOfStock}
                  onClick={() => selectProduct(product)}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 border-b border-line px-3 py-2.5 text-left last:border-b-0',
                    outOfStock ? 'cursor-not-allowed opacity-50' : 'hover:bg-page',
                    !outOfStock && index === highlightIndex && 'bg-brand/10 ring-1 ring-inset ring-brand/30',
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
        <p className="text-xs text-muted">
          Введите запрос или выберите из списка ({results.length}). Enter — добавить, ↑↓ — навигация.
        </p>
      ) : null}
      {clientSelected && search.trim() && results.length > 0 ? (
        <p className="text-xs text-muted">Enter — добавить, ↑↓ — навигация</p>
      ) : null}
    </div>
  );
}
