export const AUDIT_ACTIONS = {
  PURCHASE_CREATED: 'PURCHASE_CREATED',
  PURCHASE_EDITED: 'PURCHASE_EDITED',
  PRODUCT_ADDED: 'PRODUCT_ADDED',
  PRODUCT_REMOVED: 'PRODUCT_REMOVED',
  QUANTITY_CHANGED: 'QUANTITY_CHANGED',
  CNY_PRICE_CHANGED: 'CNY_PRICE_CHANGED',
  EXCHANGE_RATE_CHANGED: 'EXCHANGE_RATE_CHANGED',
  WEIGHT_CHANGED: 'WEIGHT_CHANGED',
  LOGISTICS_ADDED: 'LOGISTICS_ADDED',
  LOGISTICS_CHANGED: 'LOGISTICS_CHANGED',
  STATUS_CHANGED: 'STATUS_CHANGED',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditEvent {
  action: AuditAction;
  entityType: string;
  entityId: string;
  oldValue: unknown;
  newValue: unknown;
}

export interface ItemSnapshot {
  productId: string;
  quantity: string;
  unitPriceCny: string;
  unitWeightKg: string;
  exchangeRateCnyToKgs: string;
}

export interface LogisticsSnapshot {
  id?: string;
  type: string;
  amount: string;
  currency: string;
  exchangeRate: string | null;
  amountKgs: string;
  comment: string | null;
}

export interface PurchaseSnapshot {
  id: string;
  supplierId: string;
  status: string;
  exchangeRateCnyToKgs: string;
  notes: string | null;
  items: ItemSnapshot[];
  logistics: LogisticsSnapshot[];
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function buildPurchaseAuditEvents(params: {
  purchaseId: string;
  previous: PurchaseSnapshot | null;
  next: PurchaseSnapshot;
}): AuditEvent[] {
  const { purchaseId, previous, next } = params;
  const events: AuditEvent[] = [];

  if (!previous) {
    events.push({
      action: AUDIT_ACTIONS.PURCHASE_CREATED,
      entityType: 'Purchase',
      entityId: purchaseId,
      oldValue: null,
      newValue: {
        supplierId: next.supplierId,
        status: next.status,
        exchangeRateCnyToKgs: next.exchangeRateCnyToKgs,
      },
    });
    for (const item of next.items) {
      events.push({
        action: AUDIT_ACTIONS.PRODUCT_ADDED,
        entityType: 'PurchaseItem',
        entityId: purchaseId,
        oldValue: null,
        newValue: item,
      });
    }
    for (const row of next.logistics) {
      events.push({
        action: AUDIT_ACTIONS.LOGISTICS_ADDED,
        entityType: 'PurchaseLogisticsExpense',
        entityId: purchaseId,
        oldValue: null,
        newValue: row,
      });
    }
    return events;
  }

  let edited = false;

  if (previous.supplierId !== next.supplierId || previous.notes !== next.notes) {
    edited = true;
  }

  if (previous.exchangeRateCnyToKgs !== next.exchangeRateCnyToKgs) {
    events.push({
      action: AUDIT_ACTIONS.EXCHANGE_RATE_CHANGED,
      entityType: 'Purchase',
      entityId: purchaseId,
      oldValue: previous.exchangeRateCnyToKgs,
      newValue: next.exchangeRateCnyToKgs,
    });
  }

  if (previous.status !== next.status) {
    events.push({
      action: AUDIT_ACTIONS.STATUS_CHANGED,
      entityType: 'Purchase',
      entityId: purchaseId,
      oldValue: previous.status,
      newValue: next.status,
    });
  }

  const prevItems = new Map(previous.items.map((item) => [item.productId, item]));
  const nextItems = new Map(next.items.map((item) => [item.productId, item]));

  for (const [productId, item] of nextItems) {
    const oldItem = prevItems.get(productId);
    if (!oldItem) {
      events.push({
        action: AUDIT_ACTIONS.PRODUCT_ADDED,
        entityType: 'PurchaseItem',
        entityId: purchaseId,
        oldValue: null,
        newValue: item,
      });
      continue;
    }
    if (oldItem.quantity !== item.quantity) {
      events.push({
        action: AUDIT_ACTIONS.QUANTITY_CHANGED,
        entityType: 'PurchaseItem',
        entityId: purchaseId,
        oldValue: { productId, quantity: oldItem.quantity },
        newValue: { productId, quantity: item.quantity },
      });
    }
    if (oldItem.unitPriceCny !== item.unitPriceCny) {
      events.push({
        action: AUDIT_ACTIONS.CNY_PRICE_CHANGED,
        entityType: 'PurchaseItem',
        entityId: purchaseId,
        oldValue: { productId, unitPriceCny: oldItem.unitPriceCny },
        newValue: { productId, unitPriceCny: item.unitPriceCny },
      });
    }
    if (oldItem.unitWeightKg !== item.unitWeightKg) {
      events.push({
        action: AUDIT_ACTIONS.WEIGHT_CHANGED,
        entityType: 'PurchaseItem',
        entityId: purchaseId,
        oldValue: { productId, unitWeightKg: oldItem.unitWeightKg },
        newValue: { productId, unitWeightKg: item.unitWeightKg },
      });
    }
    if (oldItem.exchangeRateCnyToKgs !== item.exchangeRateCnyToKgs) {
      events.push({
        action: AUDIT_ACTIONS.EXCHANGE_RATE_CHANGED,
        entityType: 'PurchaseItem',
        entityId: purchaseId,
        oldValue: { productId, exchangeRateCnyToKgs: oldItem.exchangeRateCnyToKgs },
        newValue: { productId, exchangeRateCnyToKgs: item.exchangeRateCnyToKgs },
      });
    }
  }

  for (const [productId, item] of prevItems) {
    if (!nextItems.has(productId)) {
      events.push({
        action: AUDIT_ACTIONS.PRODUCT_REMOVED,
        entityType: 'PurchaseItem',
        entityId: purchaseId,
        oldValue: item,
        newValue: null,
      });
    }
  }

  const prevLog = previous.logistics;
  const nextLog = next.logistics;
  if (!same(prevLog, nextLog)) {
    if (prevLog.length < nextLog.length) {
      const added = nextLog.slice(prevLog.length);
      for (const row of added) {
        events.push({
          action: AUDIT_ACTIONS.LOGISTICS_ADDED,
          entityType: 'PurchaseLogisticsExpense',
          entityId: purchaseId,
          oldValue: null,
          newValue: row,
        });
      }
    }
    const shared = Math.min(prevLog.length, nextLog.length);
    for (let i = 0; i < shared; i++) {
      if (!same(prevLog[i], nextLog[i])) {
        events.push({
          action: AUDIT_ACTIONS.LOGISTICS_CHANGED,
          entityType: 'PurchaseLogisticsExpense',
          entityId: purchaseId,
          oldValue: prevLog[i],
          newValue: nextLog[i],
        });
      }
    }
    if (nextLog.length < prevLog.length) {
      for (const row of prevLog.slice(nextLog.length)) {
        events.push({
          action: AUDIT_ACTIONS.LOGISTICS_CHANGED,
          entityType: 'PurchaseLogisticsExpense',
          entityId: purchaseId,
          oldValue: row,
          newValue: null,
        });
      }
    }
  }

  if (
    edited ||
    events.some((event) =>
      [
        AUDIT_ACTIONS.QUANTITY_CHANGED,
        AUDIT_ACTIONS.CNY_PRICE_CHANGED,
        AUDIT_ACTIONS.EXCHANGE_RATE_CHANGED,
        AUDIT_ACTIONS.WEIGHT_CHANGED,
        AUDIT_ACTIONS.PRODUCT_ADDED,
        AUDIT_ACTIONS.PRODUCT_REMOVED,
        AUDIT_ACTIONS.LOGISTICS_ADDED,
        AUDIT_ACTIONS.LOGISTICS_CHANGED,
      ].includes(event.action as typeof AUDIT_ACTIONS.QUANTITY_CHANGED),
    )
  ) {
    events.unshift({
      action: AUDIT_ACTIONS.PURCHASE_EDITED,
      entityType: 'Purchase',
      entityId: purchaseId,
      oldValue: {
        supplierId: previous.supplierId,
        notes: previous.notes,
        exchangeRateCnyToKgs: previous.exchangeRateCnyToKgs,
      },
      newValue: {
        supplierId: next.supplierId,
        notes: next.notes,
        exchangeRateCnyToKgs: next.exchangeRateCnyToKgs,
      },
    });
  }

  return events;
}

export const PURCHASE_STATUSES = [
  'DRAFT',
  'ORDERED',
  'PAID',
  'IN_CHINA_TRANSIT',
  'HANDED_TO_CARGO',
  'IN_TRANSIT_TO_KYRGYZSTAN',
  'ARRIVED',
  'RECEIVED',
  'RECEIVED_WITH_DISCREPANCY',
] as const;

export type PurchaseStatusValue = (typeof PURCHASE_STATUSES)[number];

export function assertValidStatus(status: string): asserts status is PurchaseStatusValue {
  if (!PURCHASE_STATUSES.includes(status as PurchaseStatusValue)) {
    throw new Error(`Недопустимый статус закупки: ${status}`);
  }
}
