import {
  EXPECTED_SOURCE_ROWS,
  EXPECTED_TOTAL_AMOUNT_KGS,
  EXPECTED_TOTAL_QUANTITY,
  groupHistoricalSales,
  normalizePhoneDigits,
  parseHistoricalSalesTsv,
  printSalesValidationReport,
  resolveProductName,
  validateHistoricalSales,
  WALK_IN_CUSTOMER_NAME,
  WALK_IN_CUSTOMER_PHONE,
} from './historical-sales-import.logic';

describe('historical-sales-import.logic', () => {
  it('normalizes phone digits across formats', () => {
    expect(normalizePhoneDigits('0554 016 142')).toBe('0554016142');
    expect(normalizePhoneDigits('0554-016-142')).toBe('0554016142');
    expect(normalizePhoneDigits('(0554) 016 142')).toBe('0554016142');
    expect(normalizePhoneDigits('0554016142')).toBe('0554016142');
  });

  it('groups sales by normalized phone + sale date only', () => {
    const parsed = [
      {
        lineNumber: 1,
        saleDate: new Date(Date.UTC(2026, 4, 14, 12)),
        phone: '0554 016 142',
        phoneDigits: '0554016142',
        productName: 'A',
        quantity: { toFixed: () => '1.000' } as never,
        unitPriceKgs: { toFixed: () => '100.00' } as never,
        lineTotalKgs: { toFixed: () => '100.00' } as never,
      },
      {
        lineNumber: 2,
        saleDate: new Date(Date.UTC(2026, 4, 14, 12)),
        phone: '0554-016-142',
        phoneDigits: '0554016142',
        productName: 'B',
        quantity: { toFixed: () => '2.000' } as never,
        unitPriceKgs: { toFixed: () => '50.00' } as never,
        lineTotalKgs: { toFixed: () => '100.00' } as never,
      },
      {
        lineNumber: 3,
        saleDate: new Date(Date.UTC(2026, 4, 14, 12)),
        phone: '0555 111 222',
        phoneDigits: '0555111222',
        productName: 'C',
        quantity: { toFixed: () => '1.000' } as never,
        unitPriceKgs: { toFixed: () => '10.00' } as never,
        lineTotalKgs: { toFixed: () => '10.00' } as never,
      },
    ];

    const groups = groupHistoricalSales(parsed as never);
    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items).toHaveLength(1);
  });

  it('maps product aliases without changing source names', () => {
    expect(resolveProductName('Аккумулятор 58Ач')).toBe(
      'Chaowei Аккумулятор 58 Ач',
    );
  });

  it('reports control total discrepancies for current repo file', () => {
    const fs = require('fs');
    const path = require('path');
    const content = fs.readFileSync(
      path.join(__dirname, '../../prisma/data/historical-sales.tsv'),
      'utf8',
    );
    const result = validateHistoricalSales(content);
    expect(result.totals.sourceRows).not.toBe(EXPECTED_SOURCE_ROWS);
    expect(result.totals.totalQuantity).not.toBe(EXPECTED_TOTAL_QUANTITY);
    expect(result.totals.totalAmountKgs).not.toBe(EXPECTED_TOTAL_AMOUNT_KGS);
    expect(result.ok).toBe(false);
  });

  it('defines walk-in customer constants', () => {
    expect(WALK_IN_CUSTOMER_NAME).toBe('Walk-in Customer');
    expect(WALK_IN_CUSTOMER_PHONE).toBe('walk-in');
  });

  it('parses TSV rows from content', () => {
    const rows = parseHistoricalSalesTsv(
      '5/14/2026\t0507 535 337\tProduct A\t1.00\t100.00\n',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].productName).toBe('Product A');
  });

  it('prints validation report without throwing', () => {
    const result = validateHistoricalSales('');
    expect(() => printSalesValidationReport(result)).not.toThrow();
  });
});
