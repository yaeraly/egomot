import { Decimal } from '@prisma/client/runtime/library';

export function toNumString(value: Decimal | string | number | null | undefined, dp?: number): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const str = typeof value === 'object' && 'toFixed' in value ? value.toFixed() : String(value);
  if (dp === undefined) {
    return str;
  }
  const [intPart, frac = ''] = str.split('.');
  const padded = (frac + '0'.repeat(dp)).slice(0, dp);
  return `${intPart}.${padded}`;
}

export function publicDecimal(value: Decimal | string | number): string {
  return typeof value === 'object' && 'toFixed' in value ? value.toFixed() : String(value);
}
