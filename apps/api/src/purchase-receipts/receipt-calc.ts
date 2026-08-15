import {
  allocateByWeight,
  dec,
  PurchaseValidationError,
  roundMoney,
  roundQty,
  roundRate,
  roundTo,
  roundUnitCost,
  roundWeight,
} from '../purchases/purchase-calc';

export { PurchaseValidationError };

export interface ReceiptItemInput {
  productId: string;
  orderedQuantity: string | number;
  receivedQuantity: string | number;
  unitPriceCny: string | number;
  unitWeightKg: string | number;
}

export interface ReceiptTransportInput {
  chinaInternalTransportKgs: string | number;
  cargoKgs: string | number;
  kyrgyzstanInternalTransportKgs: string | number;
}

export interface ReceiptCalcInput {
  exchangeRateCnyToKgs: string | number;
  items: ReceiptItemInput[];
  transport: ReceiptTransportInput;
}

export type DiscrepancyType = 'SHORTAGE' | 'EXCESS';

export interface CalculatedReceiptDiscrepancy {
  productId: string;
  orderedQuantity: ReturnType<typeof roundQty>;
  receivedQuantity: ReturnType<typeof roundQty>;
  difference: ReturnType<typeof roundQty>;
  type: DiscrepancyType;
}

export interface CalculatedReceiptItem {
  productId: string;
  orderedQuantity: ReturnType<typeof roundQty>;
  receivedQuantity: ReturnType<typeof roundQty>;
  difference: ReturnType<typeof roundQty>;
  unitPriceCny: ReturnType<typeof roundTo>;
  unitWeightKg: ReturnType<typeof roundWeight>;
  totalWeightKg: ReturnType<typeof roundWeight>;
  purchaseCostKgs: ReturnType<typeof roundMoney>;
  allocatedChinaTransportKgs: ReturnType<typeof roundMoney>;
  allocatedCargoKgs: ReturnType<typeof roundMoney>;
  allocatedKgInternalTransportKgs: ReturnType<typeof roundMoney>;
  totalAllocatedTransportKgs: ReturnType<typeof roundMoney>;
  unitLandedCostKgs: ReturnType<typeof roundUnitCost>;
  totalLandedCostKgs: ReturnType<typeof roundMoney>;
}

export interface ReceiptTotals {
  totalOrderedQuantity: ReturnType<typeof roundQty>;
  totalReceivedQuantity: ReturnType<typeof roundQty>;
  totalDifference: ReturnType<typeof roundQty>;
  totalShortage: ReturnType<typeof roundQty>;
  totalExcess: ReturnType<typeof roundQty>;
  chinaInternalTransportKgs: ReturnType<typeof roundMoney>;
  cargoKgs: ReturnType<typeof roundMoney>;
  kyrgyzstanInternalTransportKgs: ReturnType<typeof roundMoney>;
  totalTransportKgs: ReturnType<typeof roundMoney>;
  totalLandedCostKgs: ReturnType<typeof roundMoney>;
  totalWeightKg: ReturnType<typeof roundWeight>;
  exchangeRateCnyToKgs: ReturnType<typeof roundRate>;
}

export interface ReceiptCalculation {
  items: CalculatedReceiptItem[];
  discrepancies: CalculatedReceiptDiscrepancy[];
  totals: ReceiptTotals;
}

export function calculateReceipt(input: ReceiptCalcInput): ReceiptCalculation {
  const exchangeRate = roundRate(input.exchangeRateCnyToKgs);
  const chinaTotal = roundMoney(input.transport.chinaInternalTransportKgs);
  const cargoTotal = roundMoney(input.transport.cargoKgs);
  const kgTotal = roundMoney(input.transport.kyrgyzstanInternalTransportKgs);
  const transportTotal = roundMoney(chinaTotal.plus(cargoTotal).plus(kgTotal));

  const items: CalculatedReceiptItem[] = input.items.map((row) => {
    const orderedQuantity = roundQty(row.orderedQuantity);
    const receivedQuantity = roundQty(row.receivedQuantity);
    if (receivedQuantity.lt(0)) {
      throw new PurchaseValidationError(['Фактическое количество не может быть отрицательным']);
    }
    const difference = roundQty(receivedQuantity.minus(orderedQuantity));
    const unitPriceCny = roundTo(row.unitPriceCny, 4);
    const unitWeightKg = roundWeight(row.unitWeightKg);
    const totalWeightKg = roundWeight(receivedQuantity.times(unitWeightKg));
    const purchaseCostKgs = roundMoney(receivedQuantity.times(unitPriceCny).times(exchangeRate));

    return {
      productId: row.productId,
      orderedQuantity,
      receivedQuantity,
      difference,
      unitPriceCny,
      unitWeightKg,
      totalWeightKg,
      purchaseCostKgs,
      allocatedChinaTransportKgs: roundMoney(0),
      allocatedCargoKgs: roundMoney(0),
      allocatedKgInternalTransportKgs: roundMoney(0),
      totalAllocatedTransportKgs: roundMoney(0),
      unitLandedCostKgs: roundUnitCost(0),
      totalLandedCostKgs: roundMoney(0),
    };
  });

  const weights = items.map((item) => item.totalWeightKg);
  const totalWeightKg = roundWeight(weights.reduce((sum, w) => sum.plus(w), dec(0)));

  if (transportTotal.gt(0) && totalWeightKg.lte(0)) {
    throw new PurchaseValidationError([
      'Нельзя распределить транспорт: общий вес принятого товара равен нулю',
    ]);
  }

  const chinaAlloc = allocateByWeight(weights, chinaTotal);
  const cargoAlloc = allocateByWeight(weights, cargoTotal);
  const kgAlloc = allocateByWeight(weights, kgTotal);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    item.allocatedChinaTransportKgs = chinaAlloc[i];
    item.allocatedCargoKgs = cargoAlloc[i];
    item.allocatedKgInternalTransportKgs = kgAlloc[i];
    item.totalAllocatedTransportKgs = roundMoney(
      item.allocatedChinaTransportKgs
        .plus(item.allocatedCargoKgs)
        .plus(item.allocatedKgInternalTransportKgs),
    );
    item.totalLandedCostKgs = roundMoney(
      item.purchaseCostKgs.plus(item.totalAllocatedTransportKgs),
    );
    item.unitLandedCostKgs = item.receivedQuantity.gt(0)
      ? roundUnitCost(item.totalLandedCostKgs.div(item.receivedQuantity))
      : roundUnitCost(0);
  }

  const discrepancies: CalculatedReceiptDiscrepancy[] = items
    .filter((item) => !item.difference.eq(0))
    .map((item) => ({
      productId: item.productId,
      orderedQuantity: item.orderedQuantity,
      receivedQuantity: item.receivedQuantity,
      difference: item.difference,
      type: item.difference.lt(0) ? 'SHORTAGE' : 'EXCESS',
    }));

  const totalOrderedQuantity = roundQty(
    items.reduce((sum, item) => sum.plus(item.orderedQuantity), dec(0)),
  );
  const totalReceivedQuantity = roundQty(
    items.reduce((sum, item) => sum.plus(item.receivedQuantity), dec(0)),
  );
  const totalDifference = roundQty(totalReceivedQuantity.minus(totalOrderedQuantity));
  const totalShortage = roundQty(
    discrepancies
      .filter((d) => d.type === 'SHORTAGE')
      .reduce((sum, d) => sum.plus(d.difference.abs()), dec(0)),
  );
  const totalExcess = roundQty(
    discrepancies
      .filter((d) => d.type === 'EXCESS')
      .reduce((sum, d) => sum.plus(d.difference), dec(0)),
  );
  const totalLandedCostKgs = roundMoney(
    items.reduce((sum, item) => sum.plus(item.totalLandedCostKgs), dec(0)),
  );

  return {
    items,
    discrepancies,
    totals: {
      totalOrderedQuantity,
      totalReceivedQuantity,
      totalDifference,
      totalShortage,
      totalExcess,
      chinaInternalTransportKgs: chinaTotal,
      cargoKgs: cargoTotal,
      kyrgyzstanInternalTransportKgs: kgTotal,
      totalTransportKgs: transportTotal,
      totalLandedCostKgs,
      totalWeightKg,
      exchangeRateCnyToKgs: exchangeRate,
    },
  };
}

export function computeInventoryAfterReceipt(params: {
  currentQuantity: string | number;
  currentTotalValueKgs: string | number;
  receivedQuantity: string | number;
  unitLandedCostKgs: string | number;
}) {
  const prevQty = roundQty(params.currentQuantity);
  const prevValue = roundMoney(params.currentTotalValueKgs);
  const receivedQty = roundQty(params.receivedQuantity);
  const unitCost = roundUnitCost(params.unitLandedCostKgs);
  const addedValue = roundMoney(receivedQty.times(unitCost));
  const newQty = roundQty(prevQty.plus(receivedQty));
  const newValue = roundMoney(prevValue.plus(addedValue));
  const newAvg = newQty.gt(0) ? roundUnitCost(newValue.div(newQty)) : roundUnitCost(0);

  return {
    previousQuantity: prevQty,
    newQuantity: newQty,
    addedValue,
    newTotalValueKgs: newValue,
    averageUnitCostKgs: newAvg,
    unitCost,
    totalCost: addedValue,
  };
}
