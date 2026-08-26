import { Decimal, moneyStr, roundMoney } from '../purchases/purchase-calc';
import { ACCOUNT_CODE } from './accounting-codes';
import {
  InvalidJournalLineError,
  line,
  remainingPayableAmount,
  type JournalLineDraft,
} from './accounting-journal.logic';

export const AP_RECLASS_SOURCE_PREFIX = 'ap-reclass:';

export type PurchaseCostSplit = {
  landedKgs: Decimal;
  goodsKgs: Decimal;
  chinaTransportKgs: Decimal;
  cargoKgs: Decimal;
  kyrgyzstanTransportKgs: Decimal;
  transportKgs: Decimal;
  supplierKgs: Decimal;
};

export type PurchaseUnpaidSplit = {
  supplierUnpaidKgs: Decimal;
  cargoUnpaidKgs: Decimal;
  chinaUnpaidKgs: Decimal;
  kyrgyzstanUnpaidKgs: Decimal;
  transportUnpaidKgs: Decimal;
  totalUnpaidKgs: Decimal;
};

export type ApReclassMove = {
  cargoKgs: Decimal;
  chinaKgs: Decimal;
  kyrgyzstanKgs: Decimal;
};

function nonNegative(value: Decimal.Value, label: string): Decimal {
  const amount = roundMoney(value);
  if (amount.lt(0)) {
    throw new InvalidJournalLineError(`${label} cannot be negative`);
  }
  return amount;
}

/**
 * Allocate landed cost across goods / China transport / cargo / Kyrgyzstan transport.
 * Supplier AP owns goods only. Cargo AP owns cargo only. Transport AP owns China + KG.
 */
export function splitPurchaseLandedCost(params: {
  landedKgs?: Decimal.Value;
  goodsKgs?: Decimal.Value;
  chinaTransportKgs?: Decimal.Value;
  cargoKgs?: Decimal.Value;
  kyrgyzstanTransportKgs?: Decimal.Value;
}): PurchaseCostSplit {
  const chinaReq = nonNegative(params.chinaTransportKgs ?? 0, 'China transport');
  const cargoReq = nonNegative(params.cargoKgs ?? 0, 'Cargo');
  const kyrgyzstanReq = nonNegative(params.kyrgyzstanTransportKgs ?? 0, 'Kyrgyzstan transport');

  let landed: Decimal;
  let goods: Decimal;
  let china: Decimal;
  let cargo: Decimal;
  let kyrgyzstan: Decimal;

  if (params.goodsKgs != null) {
    goods = nonNegative(params.goodsKgs, 'Goods');
    china = chinaReq;
    cargo = cargoReq;
    kyrgyzstan = kyrgyzstanReq;
    landed =
      params.landedKgs != null
        ? nonNegative(params.landedKgs, 'Landed cost')
        : roundMoney(goods.plus(china).plus(cargo).plus(kyrgyzstan));
    if (!roundMoney(goods.plus(china).plus(cargo).plus(kyrgyzstan)).eq(landed)) {
      throw new InvalidJournalLineError('Goods plus logistics must equal landed inventory');
    }
  } else if (params.landedKgs != null) {
    landed = nonNegative(params.landedKgs, 'Landed cost');
    cargo = roundMoney(Decimal.min(landed, cargoReq));
    let rest = roundMoney(landed.minus(cargo));
    china = roundMoney(Decimal.min(rest, chinaReq));
    rest = roundMoney(rest.minus(china));
    kyrgyzstan = roundMoney(Decimal.min(rest, kyrgyzstanReq));
    goods = roundMoney(landed.minus(cargo).minus(china).minus(kyrgyzstan));
  } else {
    throw new InvalidJournalLineError('Goods or landed inventory amount is required');
  }

  return {
    landedKgs: landed,
    goodsKgs: goods,
    chinaTransportKgs: china,
    cargoKgs: cargo,
    kyrgyzstanTransportKgs: kyrgyzstan,
    transportKgs: roundMoney(china.plus(kyrgyzstan)),
    supplierKgs: goods,
  };
}

export function unpaidPurchaseObligations(params: {
  goodsKgs: Decimal.Value;
  chinaTransportKgs?: Decimal.Value;
  cargoKgs?: Decimal.Value;
  kyrgyzstanTransportKgs?: Decimal.Value;
  goodsPaidKgs?: Decimal.Value;
  chinaPaidKgs?: Decimal.Value;
  cargoPaidKgs?: Decimal.Value;
  kyrgyzstanPaidKgs?: Decimal.Value;
}): PurchaseUnpaidSplit {
  const split = splitPurchaseLandedCost({
    goodsKgs: params.goodsKgs,
    chinaTransportKgs: params.chinaTransportKgs,
    cargoKgs: params.cargoKgs,
    kyrgyzstanTransportKgs: params.kyrgyzstanTransportKgs,
  });
  const supplierUnpaidKgs = remainingPayableAmount(split.goodsKgs, params.goodsPaidKgs ?? 0);
  const cargoUnpaidKgs = remainingPayableAmount(split.cargoKgs, params.cargoPaidKgs ?? 0);
  const chinaUnpaidKgs = remainingPayableAmount(split.chinaTransportKgs, params.chinaPaidKgs ?? 0);
  const kyrgyzstanUnpaidKgs = remainingPayableAmount(
    split.kyrgyzstanTransportKgs,
    params.kyrgyzstanPaidKgs ?? 0,
  );
  const transportUnpaidKgs = roundMoney(chinaUnpaidKgs.plus(kyrgyzstanUnpaidKgs));
  return {
    supplierUnpaidKgs,
    cargoUnpaidKgs,
    chinaUnpaidKgs,
    kyrgyzstanUnpaidKgs,
    transportUnpaidKgs,
    totalUnpaidKgs: roundMoney(supplierUnpaidKgs.plus(cargoUnpaidKgs).plus(transportUnpaidKgs)),
  };
}

/**
 * Move excess Supplier AP onto Cargo AP / Transport AP without touching Inventory.
 * Positive remaining-vs-target on 2000 is reclassified only into AP gaps.
 */
export function planApReclassMove(params: {
  supplierRemainingKgs: Decimal.Value;
  cargoRemainingKgs: Decimal.Value;
  chinaRemainingKgs?: Decimal.Value;
  kyrgyzstanRemainingKgs?: Decimal.Value;
  transportRemainingKgs?: Decimal.Value;
  supplierTargetUnpaidKgs: Decimal.Value;
  cargoTargetUnpaidKgs: Decimal.Value;
  chinaTargetUnpaidKgs?: Decimal.Value;
  kyrgyzstanTargetUnpaidKgs?: Decimal.Value;
  transportTargetUnpaidKgs?: Decimal.Value;
}): ApReclassMove {
  const excessSupplier = Decimal.max(
    0,
    roundMoney(roundMoney(params.supplierRemainingKgs).minus(roundMoney(params.supplierTargetUnpaidKgs))),
  );
  const cargoGap = Decimal.max(
    0,
    roundMoney(roundMoney(params.cargoTargetUnpaidKgs).minus(roundMoney(params.cargoRemainingKgs))),
  );
  const chinaTarget = roundMoney(params.chinaTargetUnpaidKgs ?? 0);
  const kgTarget = roundMoney(params.kyrgyzstanTargetUnpaidKgs ?? 0);
  const transportTarget =
    params.chinaTargetUnpaidKgs != null || params.kyrgyzstanTargetUnpaidKgs != null
      ? roundMoney(chinaTarget.plus(kgTarget))
      : roundMoney(params.transportTargetUnpaidKgs ?? 0);
  const chinaRemaining = roundMoney(params.chinaRemainingKgs ?? 0);
  const kgRemaining = roundMoney(params.kyrgyzstanRemainingKgs ?? 0);
  const transportRemaining =
    params.chinaRemainingKgs != null || params.kyrgyzstanRemainingKgs != null
      ? roundMoney(chinaRemaining.plus(kgRemaining))
      : roundMoney(params.transportRemainingKgs ?? 0);

  const cargoKgs = roundMoney(Decimal.min(excessSupplier, cargoGap));
  let leftover = roundMoney(excessSupplier.minus(cargoKgs));
  const transportGap = Decimal.max(0, roundMoney(transportTarget.minus(transportRemaining)));
  const transportMove = roundMoney(Decimal.min(leftover, transportGap));

  let chinaGap = Decimal.max(0, roundMoney(chinaTarget.minus(chinaRemaining)));
  let kgGap = Decimal.max(0, roundMoney(kgTarget.minus(kgRemaining)));
  if (chinaGap.plus(kgGap).eq(0) && transportMove.gt(0)) {
    chinaGap = transportMove;
    kgGap = roundMoney(0);
  }
  const chinaKgs = roundMoney(Decimal.min(transportMove, chinaGap));
  const kyrgyzstanKgs = roundMoney(Decimal.min(roundMoney(transportMove.minus(chinaKgs)), kgGap));
  return { cargoKgs, chinaKgs, kyrgyzstanKgs };
}

export function apReclassSourceId(
  purchaseId: string,
  kind: 'CARGO' | 'CHINA_INTERNAL_TRANSPORT' | 'KYRGYZSTAN_INTERNAL_TRANSPORT',
): string {
  return `${AP_RECLASS_SOURCE_PREFIX}${purchaseId}:${kind}`;
}

export function purchaseIdFromApReclassSource(sourceId: string): string | null {
  if (!sourceId.startsWith(AP_RECLASS_SOURCE_PREFIX)) return null;
  const rest = sourceId.slice(AP_RECLASS_SOURCE_PREFIX.length);
  const separator = rest.lastIndexOf(':');
  if (separator <= 0) return rest || null;
  return rest.slice(0, separator) || null;
}

export function transportTypeFromApReclassSource(
  sourceId: string,
): 'CHINA_INTERNAL_TRANSPORT' | 'KYRGYZSTAN_INTERNAL_TRANSPORT' | null {
  if (sourceId.endsWith(':CHINA_INTERNAL_TRANSPORT')) return 'CHINA_INTERNAL_TRANSPORT';
  if (sourceId.endsWith(':KYRGYZSTAN_INTERNAL_TRANSPORT')) return 'KYRGYZSTAN_INTERNAL_TRANSPORT';
  return null;
}

export function isApReclassSource(sourceType: string): boolean {
  return sourceType === 'AP_RECLASS';
}

export function buildApReclassLines(params: {
  fromSupplierKgs: Decimal.Value;
  toCargoKgs?: Decimal.Value;
  toChinaKgs?: Decimal.Value;
  toKyrgyzstanKgs?: Decimal.Value;
}): JournalLineDraft[] {
  const cargo = roundMoney(params.toCargoKgs ?? 0);
  const china = roundMoney(params.toChinaKgs ?? 0);
  const kyrgyzstan = roundMoney(params.toKyrgyzstanKgs ?? 0);
  const toTransport = roundMoney(china.plus(kyrgyzstan));
  const fromSupplier = roundMoney(params.fromSupplierKgs);
  const toTotal = roundMoney(cargo.plus(toTransport));
  if (!fromSupplier.gt(0) || !fromSupplier.eq(toTotal)) {
    throw new InvalidJournalLineError('AP reclass must move a positive Supplier AP amount onto cargo/transport AP');
  }
  const lines: JournalLineDraft[] = [
    line(ACCOUNT_CODE.SUPPLIER_AP, fromSupplier, 0, 'Reclass supplier AP to logistics AP'),
  ];
  if (cargo.gt(0)) {
    lines.push(line(ACCOUNT_CODE.CARGO_AP, 0, cargo, 'Reclass cargo AP'));
  }
  if (toTransport.gt(0)) {
    lines.push(line(ACCOUNT_CODE.TRANSPORT_AP, 0, toTransport, 'Reclass transport AP'));
  }
  return lines;
}

export function moneyOrZero(value: Decimal.Value | null | undefined): string {
  return moneyStr(value ?? 0);
}
