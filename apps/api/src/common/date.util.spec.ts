import {
  assertReceiptNotBeforePurchase,
  formatBusinessDate,
  parseBusinessDate,
  resolveDateRange,
} from './date.util';

describe('business dates', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');

  it('parses YYYY-MM-DD as UTC date', () => {
    const date = parseBusinessDate('2026-03-05');
    expect(formatBusinessDate(date)).toBe('2026-03-05');
  });

  it('rejects receipt before purchase', () => {
    expect(() =>
      assertReceiptNotBeforePurchase(
        parseBusinessDate('2026-03-04'),
        parseBusinessDate('2026-03-05'),
      ),
    ).toThrow('Дата поступления не может быть раньше даты закупки.');
  });

  it('allows receipt on or after purchase date', () => {
    expect(() =>
      assertReceiptNotBeforePurchase(
        parseBusinessDate('2026-03-28'),
        parseBusinessDate('2026-03-05'),
      ),
    ).not.toThrow();
  });

  it('resolves March custom range', () => {
    const range = resolveDateRange({ from: '2026-03-01', to: '2026-03-31' });
    expect(range?.fromIso).toBe('2026-03-01');
    expect(range?.toIso).toBe('2026-03-31');
  });

  it('March transaction is not in August month preset', () => {
    const march = parseBusinessDate('2026-03-05');
    const augustMonth = resolveDateRange({ preset: 'month', now })!;
    expect(march.getTime()).toBeLessThan(augustMonth.from.getTime());
  });

  it('March transaction is in March custom report range', () => {
    const marchRange = resolveDateRange({ from: '2026-03-01', to: '2026-03-31' })!;
    const march = parseBusinessDate('2026-03-05').getTime();
    expect(march).toBeGreaterThanOrEqual(marchRange.from.getTime());
    expect(march).toBeLessThanOrEqual(marchRange.to.getTime());
  });
});
