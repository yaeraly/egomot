import { dec, PurchaseCalcInput, PurchaseValidationError } from './purchase-calc';

const LOGISTICS_TYPES = new Set([
  'CHINA_INTERNAL_TRANSPORT',
  'CARGO',
  'KYRGYZSTAN_INTERNAL_TRANSPORT',
  'OTHER',
]);

const CURRENCIES = new Set(['CNY', 'KGS', 'USD']);

export function validatePurchaseInput(input: {
  supplierId?: string | null;
  exchangeRateCnyToKgs?: unknown;
  items?: PurchaseCalcInput['items'] | null;
  logistics?: PurchaseCalcInput['logistics'] | null;
}): void {
  const messages: string[] = [];

  if (!input.supplierId || String(input.supplierId).trim() === '') {
    messages.push('Поставщик обязателен');
  }

  const items = input.items ?? [];
  if (items.length === 0) {
    messages.push('Закупка должна содержать хотя бы одну позицию');
  }

  const productIds = new Set<string>();
  items.forEach((item, index) => {
    const label = `Позиция ${index + 1}`;
    if (!item.productId) {
      messages.push(`${label}: товар обязателен`);
    } else if (productIds.has(item.productId)) {
      messages.push(`${label}: товар уже добавлен в закупку`);
    } else {
      productIds.add(item.productId);
    }

    try {
      if (dec(item.quantity).lte(0)) {
        messages.push(`${label}: количество должно быть больше 0`);
      }
    } catch {
      messages.push(`${label}: некорректное количество`);
    }

    try {
      if (dec(item.unitPriceCny).lt(0)) {
        messages.push(`${label}: цена в CNY не может быть отрицательной`);
      }
    } catch {
      messages.push(`${label}: некорректная цена в CNY`);
    }

    try {
      if (dec(item.unitWeightKg).lte(0)) {
        messages.push(`${label}: вес единицы должен быть больше 0`);
      }
    } catch {
      messages.push(`${label}: некорректный вес единицы`);
    }
  });

  try {
    if (
      input.exchangeRateCnyToKgs === undefined ||
      input.exchangeRateCnyToKgs === null ||
      input.exchangeRateCnyToKgs === '' ||
      dec(input.exchangeRateCnyToKgs as string | number).lte(0)
    ) {
      messages.push('Курс CNY → KGS должен быть больше 0');
    }
  } catch {
    messages.push('Некорректный курс CNY → KGS');
  }

  const logistics = input.logistics ?? [];
  logistics.forEach((row, index) => {
    const label = `Логистика ${index + 1}`;
    if (!LOGISTICS_TYPES.has(row.type)) {
      messages.push(`${label}: неизвестный тип расхода`);
    }
    if (!CURRENCIES.has(row.currency)) {
      messages.push(`${label}: неизвестная валюта`);
    }
    try {
      if (dec(row.amount).lt(0)) {
        messages.push(`${label}: сумма не может быть отрицательной`);
      }
    } catch {
      messages.push(`${label}: некорректная сумма`);
    }
    if (row.currency !== 'KGS') {
      try {
        if (row.exchangeRate === undefined || row.exchangeRate === null || dec(row.exchangeRate).lte(0)) {
          messages.push(`${label}: для валюты ${row.currency} требуется положительный курс в KGS`);
        }
      } catch {
        messages.push(`${label}: некорректный курс обмена`);
      }
    }
  });

  if (messages.length > 0) {
    throw new PurchaseValidationError(messages);
  }
}
