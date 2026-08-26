import { Decimal, moneyStr, roundMoney } from '../purchases/purchase-calc';
import { ACCOUNT_CODE } from './accounting-codes';
import { payableStatusFromAmounts, remainingPayableAmount } from './accounting-journal.logic';
import {
  isApReclassSource,
  purchaseIdFromApReclassSource,
  transportTypeFromApReclassSource,
} from './payable-classification.logic';

export interface JournalApLine {
  accountCode: string;
  debitKgs: Decimal.Value;
  creditKgs: Decimal.Value;
}

export interface JournalApInput {
  id: string;
  sourceType: string;
  sourceId: string;
  reversesSourceType?: string | null;
  reversesSourceId?: string | null;
  postedAt: Date;
  lines: JournalApLine[];
}

export interface PurchaseIdLookup {
  receipts: Map<string, string>;
  purchasePayments: Map<string, string>;
  cargoPayments: Map<string, string>;
  logisticsExpenses: Map<string, string>;
  logisticsPayments: Map<string, string>;
  purchaseIds: Set<string>;
}

export interface PurchaseApAggregate {
  purchaseId: string;
  recognizedKgs: Decimal;
  paidKgs: Decimal;
  remainingKgs: Decimal;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
}

export type PayableListFilter = 'ALL' | 'OPEN' | 'UNPAID' | 'PARTIAL' | 'PAID';

export const DEFAULT_PAYABLE_LIST_FILTER: PayableListFilter = 'OPEN';

function creditMinusDebit(lines: JournalApLine[], accountCode: string): Decimal {
  return roundMoney(
    lines.reduce((sum, line) => {
      if (line.accountCode !== accountCode) return sum;
      return sum.plus(roundMoney(line.creditKgs)).minus(roundMoney(line.debitKgs));
    }, roundMoney(0)),
  );
}

export function resolveJournalPurchaseId(
  journal: JournalApInput,
  lookup: PurchaseIdLookup,
): string | null {
  const type =
    journal.sourceType === 'REVERSAL' && journal.reversesSourceType
      ? journal.reversesSourceType
      : journal.sourceType;
  const sourceId =
    journal.sourceType === 'REVERSAL' && journal.reversesSourceId
      ? journal.reversesSourceId
      : journal.sourceId;

  if (type === 'PURCHASE_RECEIPT') {
    return lookup.receipts.get(sourceId) ?? null;
  }
  if (type === 'PURCHASE') {
    return lookup.purchaseIds.has(sourceId) ? sourceId : null;
  }
  if (type === 'PURCHASE_PAYMENT') {
    return lookup.purchasePayments.get(sourceId) ?? null;
  }
  if (type === 'CARGO') {
    return (
      lookup.logisticsExpenses.get(sourceId) ??
      (lookup.purchaseIds.has(sourceId) ? sourceId : null)
    );
  }
  if (type === 'CARGO_PAYMENT') {
    return lookup.cargoPayments.get(sourceId) ?? lookup.logisticsPayments.get(sourceId) ?? null;
  }
  if (type === 'LOGISTICS_CHINA' || type === 'LOGISTICS_KYRGYZSTAN') {
    return (
      lookup.logisticsExpenses.get(sourceId) ??
      (lookup.purchaseIds.has(sourceId) ? sourceId : null)
    );
  }
  if (type === 'LOGISTICS_CHINA_PAYMENT' || type === 'LOGISTICS_KYRGYZSTAN_PAYMENT') {
    return lookup.logisticsPayments.get(sourceId) ?? null;
  }
  if (isApReclassSource(type)) {
    const purchaseId = purchaseIdFromApReclassSource(sourceId);
    if (purchaseId && lookup.purchaseIds.has(purchaseId)) return purchaseId;
    return purchaseId;
  }
  return (
    lookup.logisticsExpenses.get(sourceId) ??
    lookup.receipts.get(sourceId) ??
    (lookup.purchaseIds.has(sourceId) ? sourceId : null)
  );
}

export function transportTypeFromSource(
  sourceType: string,
  sourceId?: string,
): 'CHINA_INTERNAL_TRANSPORT' | 'KYRGYZSTAN_INTERNAL_TRANSPORT' {
  if (isApReclassSource(sourceType) && sourceId) {
    return transportTypeFromApReclassSource(sourceId) ?? 'KYRGYZSTAN_INTERNAL_TRANSPORT';
  }
  if (sourceType === 'LOGISTICS_CHINA' || sourceType === 'LOGISTICS_CHINA_PAYMENT') {
    return 'CHINA_INTERNAL_TRANSPORT';
  }
  return 'KYRGYZSTAN_INTERNAL_TRANSPORT';
}

function addToAggregate(
  map: Map<string, { recognized: Decimal; paid: Decimal }>,
  purchaseId: string,
  netCredit: Decimal,
  asRecognitionAdjustment = false,
) {
  const current = map.get(purchaseId) ?? { recognized: roundMoney(0), paid: roundMoney(0) };
  if (asRecognitionAdjustment) {
    current.recognized = roundMoney(Decimal.max(0, current.recognized.plus(netCredit)));
  } else if (netCredit.gt(0)) {
    current.recognized = roundMoney(current.recognized.plus(netCredit));
  } else if (netCredit.lt(0)) {
    current.paid = roundMoney(current.paid.plus(netCredit.abs()));
  }
  map.set(purchaseId, current);
}

function toAggregates(map: Map<string, { recognized: Decimal; paid: Decimal }>): PurchaseApAggregate[] {
  return [...map.entries()].map(([purchaseId, row]) => {
    const remaining = remainingPayableAmount(row.recognized, row.paid);
    return {
      purchaseId,
      recognizedKgs: roundMoney(row.recognized),
      paidKgs: roundMoney(row.paid),
      remainingKgs: remaining,
      status: payableStatusFromAmounts(row.recognized, row.paid),
    };
  });
}

export function aggregateSupplierApByPurchase(
  journals: JournalApInput[],
  lookup: PurchaseIdLookup,
): PurchaseApAggregate[] {
  const map = new Map<string, { recognized: Decimal; paid: Decimal }>();
  for (const journal of journals) {
    const purchaseId = resolveJournalPurchaseId(journal, lookup);
    if (!purchaseId) continue;
    addToAggregate(
      map,
      purchaseId,
      creditMinusDebit(journal.lines, ACCOUNT_CODE.SUPPLIER_AP),
      isApReclassSource(journal.sourceType),
    );
  }
  return toAggregates(map);
}

export function aggregateCargoApByPurchase(
  journals: JournalApInput[],
  lookup: PurchaseIdLookup,
): PurchaseApAggregate[] {
  const map = new Map<string, { recognized: Decimal; paid: Decimal }>();
  for (const journal of journals) {
    const purchaseId = resolveJournalPurchaseId(journal, lookup);
    if (!purchaseId) continue;
    addToAggregate(
      map,
      purchaseId,
      creditMinusDebit(journal.lines, ACCOUNT_CODE.CARGO_AP),
      isApReclassSource(journal.sourceType),
    );
  }
  return toAggregates(map);
}

export function aggregateTransportApByPurchaseAndType(
  journals: JournalApInput[],
  lookup: PurchaseIdLookup,
): Array<PurchaseApAggregate & { type: 'CHINA_INTERNAL_TRANSPORT' | 'KYRGYZSTAN_INTERNAL_TRANSPORT' }> {
  const map = new Map<string, { recognized: Decimal; paid: Decimal }>();
  for (const journal of journals) {
    const net = creditMinusDebit(journal.lines, ACCOUNT_CODE.TRANSPORT_AP);
    if (net.eq(0)) continue;
    const purchaseId = resolveJournalPurchaseId(journal, lookup);
    if (!purchaseId) continue;
    const sourceType =
      journal.sourceType === 'REVERSAL' && journal.reversesSourceType
        ? journal.reversesSourceType
        : journal.sourceType;
    const sourceId =
      journal.sourceType === 'REVERSAL' && journal.reversesSourceId
        ? journal.reversesSourceId
        : journal.sourceId;
    const type = transportTypeFromSource(sourceType, sourceId);
    const key = `${purchaseId}:${type}`;
    addToAggregate(map, key, net, isApReclassSource(journal.sourceType));
  }
  return toAggregates(map).map((row) => {
    const [purchaseId, type] = row.purchaseId.split(':') as [
      string,
      'CHINA_INTERNAL_TRANSPORT' | 'KYRGYZSTAN_INTERNAL_TRANSPORT',
    ];
    return { ...row, purchaseId, type };
  });
}

export function sumRemaining(rows: Array<{ remainingKgs: Decimal.Value }>): string {
  return moneyStr(
    rows.reduce((sum, row) => sum.plus(roundMoney(row.remainingKgs)), roundMoney(0)),
  );
}

/** Default list: remaining > 0, independent of stale status labels. */
export function isOpenPayable(remainingKgs: Decimal.Value): boolean {
  return roundMoney(remainingKgs).gt(0);
}

export function filterPayables<T extends { status: string; remainingAmountKgs: Decimal.Value }>(
  rows: T[],
  filter: PayableListFilter,
): T[] {
  if (filter === 'ALL') return rows;
  if (filter === 'OPEN') return rows.filter((row) => isOpenPayable(row.remainingAmountKgs));
  if (filter === 'PAID') {
    return rows.filter((row) => !isOpenPayable(row.remainingAmountKgs));
  }
  if (filter === 'UNPAID') {
    return rows.filter(
      (row) => isOpenPayable(row.remainingAmountKgs) && row.status === 'UNPAID',
    );
  }
  return rows.filter(
    (row) => isOpenPayable(row.remainingAmountKgs) && row.status === 'PARTIAL',
  );
}
