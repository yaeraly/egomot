import { Decimal, moneyStr, roundMoney } from '../purchases/purchase-calc';
import { ACCOUNT_CODE, type AccountCode } from './accounting-codes';
import {
  InvalidJournalLineError,
  line,
  payableStatusFromAmounts,
  remainingPayableAmount,
  type JournalLineDraft,
  type PayableStatusCode,
} from './accounting-journal.logic';

export const MISSING_PRODUCT_WEIGHT_MESSAGE = 'Не указан вес товара';

export type PurchaseLogisticsTypeCode =
  | 'CHINA_INTERNAL_TRANSPORT'
  | 'CARGO'
  | 'KYRGYZSTAN_INTERNAL_TRANSPORT'
  | 'OTHER';

export const PURCHASE_LOGISTICS_TYPES: PurchaseLogisticsTypeCode[] = [
  'CHINA_INTERNAL_TRANSPORT',
  'CARGO',
  'KYRGYZSTAN_INTERNAL_TRANSPORT',
];

export type LogisticsSettlementMode = 'PAID' | 'PARTIAL' | 'UNPAID';

export function isCargoLogisticsType(type: string): boolean {
  return type === 'CARGO';
}

export function payableAccountCodeForLogisticsType(type: string): AccountCode {
  return isCargoLogisticsType(type) ? ACCOUNT_CODE.CARGO_AP : ACCOUNT_CODE.TRANSPORT_AP;
}

export function logisticsRecognitionSourceType(type: string): string {
  if (isCargoLogisticsType(type)) return 'CARGO';
  if (type === 'CHINA_INTERNAL_TRANSPORT') return 'LOGISTICS_CHINA';
  return 'LOGISTICS_KYRGYZSTAN';
}

export function logisticsPaymentSourceType(type: string): string {
  if (isCargoLogisticsType(type)) return 'CARGO_PAYMENT';
  if (type === 'CHINA_INTERNAL_TRANSPORT') return 'LOGISTICS_CHINA_PAYMENT';
  return 'LOGISTICS_KYRGYZSTAN_PAYMENT';
}

export function isChinaLogisticsCashFlowSource(sourceType?: string): boolean {
  return sourceType === 'LOGISTICS_CHINA' || sourceType === 'LOGISTICS_CHINA_PAYMENT';
}

export function isCargoLogisticsCashFlowSource(sourceType?: string): boolean {
  return sourceType === 'CARGO' || sourceType === 'CARGO_PAYMENT';
}

export function isKyrgyzstanLogisticsCashFlowSource(sourceType?: string): boolean {
  return sourceType === 'LOGISTICS_KYRGYZSTAN' || sourceType === 'LOGISTICS_KYRGYZSTAN_PAYMENT';
}

export function resolveLogisticsSettlement(params: {
  amountKgs: Decimal.Value;
  settlement: LogisticsSettlementMode;
  paidAmountKgs?: Decimal.Value | null;
}): {
  amountKgs: Decimal;
  paidAmountKgs: Decimal;
  remainingAmountKgs: Decimal;
  status: PayableStatusCode;
} {
  const amount = roundMoney(params.amountKgs);
  if (!amount.gt(0)) {
    throw new InvalidJournalLineError('Logistics amount must be greater than zero');
  }

  let paid = roundMoney(0);
  if (params.settlement === 'PAID') {
    paid = amount;
  } else if (params.settlement === 'PARTIAL') {
    paid = roundMoney(params.paidAmountKgs ?? 0);
  }

  if (paid.lt(0) || paid.gt(amount)) {
    throw new InvalidJournalLineError('Logistics paid amount is out of range');
  }
  if (params.settlement === 'PARTIAL' && (!paid.gt(0) || paid.gte(amount))) {
    throw new InvalidJournalLineError('Partial logistics payment must be between 0 and the total');
  }

  const remaining = remainingPayableAmount(amount, paid);
  return {
    amountKgs: amount,
    paidAmountKgs: paid,
    remainingAmountKgs: remaining,
    status: payableStatusFromAmounts(amount, paid),
  };
}

/**
 * Recognize a purchase logistics / landed cost.
 * Fully paid: Dr Inventory / Cr Cash|Bank — no AP.
 * Unpaid: Dr Inventory / Cr Cargo AP 2010 or Transport AP 2020.
 * Partial: Dr Inventory / Cr Cash|Bank / Cr AP. Always balanced.
 */
export function buildLogisticsCostLines(params: {
  amountKgs: Decimal.Value;
  paidKgs?: Decimal.Value;
  payableAccountCode: AccountCode;
  cashAccountCode?: AccountCode;
}): JournalLineDraft[] {
  const amount = roundMoney(params.amountKgs);
  if (!amount.gt(0)) {
    throw new InvalidJournalLineError('Logistics amount must be greater than zero');
  }
  const paid = roundMoney(params.paidKgs ?? 0);
  if (paid.lt(0) || paid.gt(amount)) {
    throw new InvalidJournalLineError('Logistics paid amount is out of range');
  }
  const unpaid = remainingPayableAmount(amount, paid);
  const cashCode = params.cashAccountCode ?? ACCOUNT_CODE.CASH;
  const lines: JournalLineDraft[] = [
    line(ACCOUNT_CODE.INVENTORY, amount, 0, 'Purchase logistics landed cost'),
  ];
  if (paid.gt(0)) {
    lines.push(line(cashCode, 0, paid, 'Purchase logistics payment'));
  }
  if (unpaid.gt(0)) {
    lines.push(line(params.payableAccountCode, 0, unpaid, 'Purchase logistics payable'));
  }
  return lines;
}

/** Later settlement of logistics AP. Must not debit Inventory. */
export function buildLogisticsApPaymentLines(params: {
  amountKgs: Decimal.Value;
  payableAccountCode: AccountCode;
  cashAccountCode?: AccountCode;
}): JournalLineDraft[] {
  const amount = roundMoney(params.amountKgs);
  if (!amount.gt(0)) {
    throw new InvalidJournalLineError('Logistics payment must be greater than zero');
  }
  const cashCode = params.cashAccountCode ?? ACCOUNT_CODE.CASH;
  return [
    line(params.payableAccountCode, amount, 0, 'Logistics debt payment'),
    line(cashCode, 0, amount, 'Logistics debt payment'),
  ];
}

export function moneySnapshot(value: Decimal.Value): string {
  return moneyStr(value);
}
