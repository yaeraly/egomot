'use client';

import { useMemo, useState } from 'react';
import { Client, CLIENT_TYPE_LABELS } from '@/lib/types';
import { Button, Field, SearchBox, cn } from '@/components/ui';

type Props = {
  clients: Client[];
  clientId: string;
  onSelect: (clientId: string) => void;
  onClear: () => void;
};

export function PosCustomerSearch({ clients, clientId, onSelect, onClear }: Props) {
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () => clients.find((c) => c.id === clientId) ?? null,
    [clients, clientId],
  );

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clients.slice(0, 15);
    return clients.filter((c) => {
      const haystack = [c.name, c.companyName, c.phone, c.email, c.city]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    }).slice(0, 20);
  }, [clients, query]);

  if (selected) {
    return (
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2 rounded-xl border border-brand/30 bg-brand/5 px-3 py-3">
          <div>
            <p className="font-semibold">{selected.name}</p>
            <p className="text-sm text-muted">
              {CLIENT_TYPE_LABELS[selected.clientType]}
              {selected.companyName ? ` · ${selected.companyName}` : ''}
            </p>
            <p className="text-sm text-muted">{selected.phone}</p>
          </div>
          <Button type="button" variant="ghost" className="min-h-10 shrink-0 px-3 text-sm" onClick={onClear}>
            Сменить
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Field label="Поиск клиента">
        <SearchBox
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Имя, телефон, компания, email"
          autoComplete="off"
        />
      </Field>
      <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-line bg-white">
        {results.length === 0 ? (
          <p className="px-3 py-4 text-sm text-muted">Клиенты не найдены</p>
        ) : (
          results.map((client) => (
            <button
              key={client.id}
              type="button"
              onClick={() => {
                onSelect(client.id);
                setQuery('');
              }}
              className={cn(
                'flex w-full flex-col items-start gap-0.5 border-b border-line px-3 py-2.5 text-left last:border-b-0 hover:bg-page',
              )}
            >
              <span className="font-medium">{client.name}</span>
              <span className="text-xs text-muted">
                {CLIENT_TYPE_LABELS[client.clientType]}
                {client.companyName ? ` · ${client.companyName}` : ''}
                {' · '}
                {client.phone}
              </span>
            </button>
          ))
        )}
      </div>
      {!query.trim() ? (
        <p className="text-xs text-muted">Показаны первые {results.length} активных клиентов. Уточните поиск.</p>
      ) : null}
    </div>
  );
}
