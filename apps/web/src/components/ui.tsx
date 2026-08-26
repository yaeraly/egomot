'use client';

import Link from 'next/link';
import { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

export function Button({
  variant = 'primary',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
}) {
  const styles = {
    primary: 'bg-brand text-white hover:bg-brand-dark',
    secondary: 'bg-white text-ink border border-line hover:bg-slate-50',
    ghost: 'bg-transparent text-ink hover:bg-slate-100',
    danger: 'bg-red-600 text-white hover:bg-red-700',
  } as const;
  return (
    <button
      className={cn(
        'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition disabled:opacity-50',
        styles[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20',
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'min-h-12 w-full rounded-xl border border-line bg-white px-3 text-base text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20',
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full rounded-xl border border-line bg-white px-3 py-3 text-base text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20',
        className,
      )}
      {...props}
    />
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('rounded-2xl border border-line bg-white p-4 shadow-sm', className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  text,
  href,
  actionLabel,
}: {
  title: string;
  text: string;
  href?: string;
  actionLabel?: string;
}) {
  return (
    <Card className="py-10 text-center">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted">{text}</p>
      {href && actionLabel ? (
        <Link
          href={href}
          className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-brand px-4 font-semibold text-white"
        >
          {actionLabel}
        </Link>
      ) : null}
    </Card>
  );
}

export function Badge({
  children,
  tone = 'slate',
}: {
  children: React.ReactNode;
  tone?: 'slate' | 'teal' | 'amber' | 'green' | 'blue' | 'red';
}) {
  const map = {
    slate: 'bg-slate-100 text-slate-700',
    teal: 'bg-teal-50 text-teal-800',
    amber: 'bg-amber-50 text-amber-800',
    green: 'bg-emerald-50 text-emerald-800',
    blue: 'bg-sky-50 text-sky-800',
    red: 'bg-red-50 text-red-700',
  };
  return (
    <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-semibold', map[tone])}>
      {children}
    </span>
  );
}

export function ErrorText({ error }: { error?: string | null }) {
  if (!error) return null;
  return <p className="whitespace-pre-line rounded-xl bg-red-50 px-3 py-2 text-sm text-danger">{error}</p>;
}

export function SearchBox(props: InputHTMLAttributes<HTMLInputElement>) {
  return <Input placeholder="Поиск" {...props} />;
}
