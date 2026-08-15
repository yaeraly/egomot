import { BadRequestException } from '@nestjs/common';

export type DateRangePreset =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | 'prev_month'
  | 'quarter'
  | 'year'
  | 'custom';

const PRESET_LABELS: Record<DateRangePreset, string> = {
  today: 'Сегодня',
  yesterday: 'Вчера',
  week: 'Неделя',
  month: 'Месяц',
  prev_month: 'Предыдущий месяц',
  quarter: 'Квартал',
  year: 'Год',
  custom: 'Произвольный период',
};

export function isValidPreset(value: string): value is DateRangePreset {
  return value in PRESET_LABELS;
}

export function parseBusinessDate(value: string, fieldLabel = 'Дата'): Date {
  const raw = value.split('T')[0];
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) {
    throw new BadRequestException(`${fieldLabel}: ожидается формат YYYY-MM-DD`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestException(`${fieldLabel}: недопустимая дата`);
  }
  return date;
}

export function formatBusinessDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function endOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 23, 59, 59, 999));
}

export function compareBusinessDates(a: Date, b: Date): number {
  return startOfUtcDay(a).getTime() - startOfUtcDay(b).getTime();
}

export function assertReceiptNotBeforePurchase(receiptDate: Date, purchaseDate: Date | null) {
  if (!purchaseDate) return;
  if (compareBusinessDates(receiptDate, purchaseDate) < 0) {
    throw new BadRequestException('Дата поступления не может быть раньше даты закупки.');
  }
}

export interface ResolvedDateRange {
  preset: DateRangePreset | 'custom';
  from: Date;
  to: Date;
  fromIso: string;
  toIso: string;
}

export function resolveDateRange(params: {
  preset?: string;
  from?: string;
  to?: string;
  now?: Date;
}): ResolvedDateRange | null {
  const now = params.now ?? new Date();
  const today = startOfUtcDay(now);

  if (params.preset && params.preset !== 'custom') {
    if (!isValidPreset(params.preset)) {
      throw new BadRequestException(`Неизвестный период: ${params.preset}`);
    }
    const preset = params.preset;
    let from = today;
    let to = endOfUtcDay(today);

    switch (preset) {
      case 'today':
        break;
      case 'yesterday': {
        from = new Date(today);
        from.setUTCDate(from.getUTCDate() - 1);
        to = endOfUtcDay(from);
        break;
      }
      case 'week': {
        from = new Date(today);
        from.setUTCDate(from.getUTCDate() - 6);
        break;
      }
      case 'month':
        from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
        break;
      case 'prev_month': {
        from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
        to = endOfUtcDay(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)));
        break;
      }
      case 'quarter': {
        const q = Math.floor(today.getUTCMonth() / 3);
        from = new Date(Date.UTC(today.getUTCFullYear(), q * 3, 1));
        break;
      }
      case 'year':
        from = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
        break;
      default:
        break;
    }

    return {
      preset,
      from,
      to,
      fromIso: formatBusinessDate(from)!,
      toIso: formatBusinessDate(to)!,
    };
  }

  if (params.from && params.to) {
    const from = startOfUtcDay(parseBusinessDate(params.from, 'Дата начала'));
    const to = endOfUtcDay(parseBusinessDate(params.to, 'Дата окончания'));
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException('Дата начала не может быть позже даты окончания');
    }
    return {
      preset: 'custom',
      from,
      to,
      fromIso: formatBusinessDate(from)!,
      toIso: formatBusinessDate(to)!,
    };
  }

  return null;
}

export function businessDateRangeFilter(from: Date, to: Date) {
  return {
    gte: startOfUtcDay(from),
    lte: endOfUtcDay(to),
  };
}

export { PRESET_LABELS };
