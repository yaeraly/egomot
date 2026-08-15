'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { cn } from './ui';

const NAV = [
  { href: '/', label: 'Dashboard', icon: HomeIcon },
  { href: '/products', label: 'Товары', icon: BoxIcon },
  { href: '/suppliers', label: 'Поставщики', icon: UsersIcon },
  { href: '/purchases', label: 'Закупки', icon: CartIcon },
  { href: '/settings', label: 'Настройки', icon: CogIcon },
];

const WAREHOUSE_NAV = [
  { href: '/warehouse/stock', label: 'Остатки' },
  { href: '/warehouse/receipts', label: 'Приход' },
  { href: '/warehouse/movements', label: 'Движения' },
  { href: '/warehouse/inventory-count', label: 'Инвентаризация' },
];

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}
function BoxIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M21 8 12 3 3 8l9 5 9-5z" />
      <path d="M3 8v8l9 5 9-5V8" />
    </svg>
  );
}
function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19a6 6 0 0 1 12 0" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 19a5 5 0 0 1 5-4" />
    </svg>
  );
}
function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 6h2l2.2 10.4A2 2 0 0 0 10.16 18h7.5a2 2 0 0 0 2-1.6L21 9H7" />
      <circle cx="10" cy="20" r="1.2" />
      <circle cx="18" cy="20" r="1.2" />
    </svg>
  );
}
function WarehouseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 9.5 12 4l9 5.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" />
      <path d="M9 13h6" />
    </svg>
  );
}
function CogIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a7.8 7.8 0 0 0 .1-6l2-1.1-2-3.5-2.3.7a8 8 0 0 0-5.2-2.1L11.4 1H8.6l-.6 2a8 8 0 0 0-5.2 2.1L.5 4.4l-2 3.5 2 1.1a7.8 7.8 0 0 0 .1 6l-2 1.1 2 3.5 2.3-.7a8 8 0 0 0 5.2 2.1l.6 2h2.8l.6-2a8 8 0 0 0 5.2-2.1l2.3.7 2-3.5z" />
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const warehouseOpen = pathname.startsWith('/warehouse');

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!loading && !user) {
      window.location.href = '/login';
    }
  }, [loading, user]);

  if (loading || !user) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-muted">Загрузка…</div>
    );
  }

  const nav = (
    <nav className="flex flex-col gap-1">
      {NAV.slice(0, 4).map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium',
              active ? 'bg-brand text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white',
            )}
          >
            <Icon />
            {item.label}
          </Link>
        );
      })}

      <div className="mt-1">
        <Link
          href="/warehouse/stock"
          className={cn(
            'flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium',
            warehouseOpen ? 'bg-brand text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white',
          )}
        >
          <WarehouseIcon />
          Склад
        </Link>
        {warehouseOpen ? (
          <div className="ml-4 mt-1 space-y-1 border-l border-white/10 pl-3">
            {WAREHOUSE_NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex min-h-10 items-center rounded-lg px-3 text-sm',
                    active ? 'bg-white/15 text-white' : 'text-slate-400 hover:bg-white/10 hover:text-white',
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>

      {NAV.slice(4).map((item) => {
        const active = pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium',
              active ? 'bg-brand text-white' : 'text-slate-300 hover:bg-white/10 hover:text-white',
            )}
          >
            <Icon />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-page">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-slate-950 p-4 lg:flex">
        <div className="mb-8 px-2">
          <p className="text-lg font-bold text-white">Egomot</p>
          <p className="text-xs text-slate-400">Управление закупками</p>
        </div>
        {nav}
        <div className="mt-auto border-t border-white/10 pt-4">
          <p className="truncate px-2 text-sm text-white">{user.name}</p>
          <p className="truncate px-2 text-xs text-slate-400">{user.email}</p>
          <button
            onClick={logout}
            className="mt-3 min-h-11 w-full rounded-xl px-3 text-left text-sm text-slate-300 hover:bg-white/10"
          >
            Выйти
          </button>
        </div>
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} aria-label="Закрыть меню" />
          <aside className="relative flex h-full w-[min(100%,18rem)] flex-col bg-slate-950 p-4">
            <div className="mb-6 flex items-center justify-between px-2">
              <p className="text-lg font-bold text-white">Egomot</p>
              <button onClick={() => setOpen(false)} className="text-slate-300">
                Закрыть
              </button>
            </div>
            {nav}
            <div className="mt-auto border-t border-white/10 pt-4">
              <p className="truncate px-2 text-sm text-white">{user.name}</p>
              <button onClick={logout} className="mt-3 min-h-11 w-full rounded-xl px-3 text-left text-sm text-slate-300">
                Выйти
              </button>
            </div>
          </aside>
        </div>
      ) : null}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex min-h-14 items-center gap-3 border-b border-line bg-white/95 px-4 backdrop-blur lg:hidden">
          <button
            onClick={() => setOpen(true)}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-line"
            aria-label="Открыть меню"
          >
            <span className="sr-only">Меню</span>
            <div className="space-y-1.5">
              <span className="block h-0.5 w-5 bg-ink" />
              <span className="block h-0.5 w-5 bg-ink" />
              <span className="block h-0.5 w-5 bg-ink" />
            </div>
          </button>
          <p className="font-semibold">Egomot</p>
        </header>
        <main className="mx-auto w-full max-w-6xl px-4 py-4 pb-24 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
