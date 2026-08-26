/** Format Date for `<input type="datetime-local" />` in local time. */
export function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Parse datetime-local value to ISO string for API. */
export function datetimeLocalToIso(value: string): string {
  return new Date(value).toISOString();
}

export function formatSaleDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU');
}
