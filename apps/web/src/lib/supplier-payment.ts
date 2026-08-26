import { api } from '@/lib/api';

export interface SupplierPayablePaymentTarget {
  purchaseId: string;
  supplierName: string;
  purchaseNumber: string;
  amountKgs: string;
  paidAmountKgs: string;
  remainingAmountKgs: string;
  dueDate?: string | null;
}

export interface CompanyPaymentAccount {
  id: string;
  name: string;
  paymentMethodCode: string;
}

export interface SupplierPaymentFormValues {
  amountKgs: string;
  paymentAccountId: string;
  paidAt: string;
  note: string;
}

function parseAmount(value: string): number {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) return Number.NaN;
  return Number(normalized);
}

export function validateSupplierPaymentForm(
  values: SupplierPaymentFormValues,
  remainingAmountKgs: string,
): string | null {
  const amount = parseAmount(values.amountKgs);
  const remaining = parseAmount(remainingAmountKgs);

  if (Number.isNaN(amount) || amount <= 0) {
    return 'Сумма оплаты должна быть больше 0';
  }
  if (Number.isNaN(remaining)) {
    return 'Некорректный остаток долга';
  }
  if (amount > remaining + 0.0001) {
    return 'Сумма оплаты не может превышать остаток долга';
  }
  if (!values.paymentAccountId.trim()) {
    return 'Выберите счёт оплаты: Наличные или Банк';
  }
  if (!values.paidAt.trim()) {
    return 'Укажите дату оплаты';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.paidAt.trim())) {
    return 'Некорректная дата оплаты';
  }
  const [year, month, day] = values.paidAt.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return 'Некорректная дата оплаты';
  }
  return null;
}

export async function submitSupplierPayment(
  purchaseId: string,
  values: SupplierPaymentFormValues,
) {
  return api(`/accounting/purchases/${purchaseId}/payments`, {
    method: 'POST',
    body: JSON.stringify({
      amountKgs: values.amountKgs.trim(),
      paymentAccountId: values.paymentAccountId,
      paidAt: values.paidAt,
      note: values.note.trim() || undefined,
    }),
  });
}

export type PayableKind = 'SUPPLIER' | 'CARGO' | 'TRANSPORT';
export type PayablePayPath = 'SUPPLIER' | 'LOGISTICS' | 'CARGO_PAYABLE' | 'TRANSPORT_PAYABLE';

export interface PayablePaymentTarget extends SupplierPayablePaymentTarget {
  kind: PayableKind;
  payableId?: string;
  expenseId?: string | null;
  payPath?: PayablePayPath;
}

export async function submitPayablePayment(
  target: PayablePaymentTarget,
  values: SupplierPaymentFormValues,
) {
  const body = JSON.stringify({
    amountKgs: values.amountKgs.trim(),
    paymentAccountId: values.paymentAccountId,
    paidAt: values.paidAt,
    note: values.note.trim() || undefined,
  });
  const path = target.payPath ?? (target.kind === 'SUPPLIER' ? 'SUPPLIER' : 'LOGISTICS');
  if (path === 'SUPPLIER') {
    return submitSupplierPayment(target.purchaseId, values);
  }
  if (path === 'CARGO_PAYABLE' && target.payableId) {
    return api(`/accounting/cargo-payables/${target.payableId}/payments`, {
      method: 'POST',
      body,
    });
  }
  if (path === 'TRANSPORT_PAYABLE' && target.payableId) {
    return api(`/accounting/transport-payables/${target.payableId}/payments`, {
      method: 'POST',
      body,
    });
  }
  const expenseId = target.expenseId;
  if (!expenseId) {
    throw new Error('Не указан расход логистики для оплаты');
  }
  return api(`/accounting/logistics/${expenseId}/payments`, {
    method: 'POST',
    body,
  });
}

export function supplierPaymentTargetFromPayable(row: {
  purchaseId?: string;
  supplierName: string;
  purchaseNumber: string;
  amountKgs: string;
  paidAmountKgs: string;
  remainingAmountKgs: string;
  dueDate?: string | null;
}): SupplierPayablePaymentTarget | null {
  if (!row.purchaseId) return null;
  return {
    purchaseId: row.purchaseId,
    supplierName: row.supplierName,
    purchaseNumber: row.purchaseNumber,
    amountKgs: row.amountKgs,
    paidAmountKgs: row.paidAmountKgs,
    remainingAmountKgs: row.remainingAmountKgs,
    dueDate: row.dueDate ?? null,
  };
}

export function supplierPaymentTargetFromPurchase(purchase: {
  id: string;
  number: string;
  supplier?: { name?: string } | null;
  supplierPaidAmountKgs?: string | null;
  supplierUnpaidAmountKgs?: string | null;
}): SupplierPayablePaymentTarget | null {
  const remaining = Number(purchase.supplierUnpaidAmountKgs ?? 0);
  if (remaining <= 0) return null;
  const paid = purchase.supplierPaidAmountKgs ?? '0';
  const total = String(Number(paid) + remaining);
  return {
    purchaseId: purchase.id,
    supplierName: purchase.supplier?.name ?? 'Поставщик',
    purchaseNumber: purchase.number,
    amountKgs: total,
    paidAmountKgs: paid,
    remainingAmountKgs: purchase.supplierUnpaidAmountKgs ?? '0',
  };
}
