import Decimal from 'decimal.js';
import {
  buildSaleGroupKey,
  buildSourceRowId,
  FINAL_EXPECTED_SOURCE_ROWS,
  FINAL_EXPECTED_TOTAL_AMOUNT_KGS,
  FINAL_EXPECTED_TOTAL_QUANTITY,
  filterNewRows,
  groupHistoricalSales,
  normalizePhoneDigits,
  isRoznichnyCustomer,
  parseHistoricalSalesTsv,
  resolveBatchStatus,
  resolveHistoricalCustomer,
  resolveProductName,
  resolveValidateExitCode,
  validateFinalHistoricalSales,
  validateHistoricalSalesBatch,
  WALK_IN_CUSTOMER_NAME,
  WALK_IN_CUSTOMER_PHONE,
  WALK_IN_GROUP_TOKEN,
} from './historical-sales-import.logic';

const SAMPLE_ROW =
  '5/14/2026\t0507 535 337\tЖелмаян Контроллер 1,8 кВт 70H\t1.00\t3940.00\n';

function parsedRow(overrides: Partial<{
  lineNumber: number;
  saleDate: Date;
  phone: string;
  phoneDigits: string;
  productName: string;
  quantity: string;
  unitPriceKgs: string;
}> = {}) {
  const saleDate = overrides.saleDate ?? new Date(Date.UTC(2026, 4, 14, 12));
  const phoneDigits = overrides.phoneDigits ?? '0507535337';
  const quantity = new Decimal(overrides.quantity ?? '1');
  const unitPriceKgs = new Decimal(overrides.unitPriceKgs ?? '100');
  const productName = overrides.productName ?? 'Product A';
  const lineNumber = overrides.lineNumber ?? 1;
  const base = {
    lineNumber,
    saleDate,
    phone: overrides.phone ?? '0507 535 337',
    phoneDigits,
    isWalkIn: phoneDigits === WALK_IN_GROUP_TOKEN,
    productName,
    quantity,
    unitPriceKgs,
    lineTotalKgs: quantity.times(unitPriceKgs),
  };
  return {
    ...base,
    sourceRowId: buildSourceRowId('historical-sales.tsv', base),
  };
}

describe('historical-sales-import.logic', () => {
  it('normalizes phone digits across formats', () => {
    expect(normalizePhoneDigits('0554 016 142')).toBe('0554016142');
    expect(normalizePhoneDigits('0554-016-142')).toBe('0554016142');
    expect(normalizePhoneDigits('(0554) 016 142')).toBe('0554016142');
  });

  it('groups sales by normalized phone + sale date only', () => {
    const groups = groupHistoricalSales([
      parsedRow({ lineNumber: 1, phoneDigits: '0554016142', phone: '0554 016 142' }),
      parsedRow({ lineNumber: 2, phoneDigits: '0554016142', phone: '0554-016-142', productName: 'B' }),
      parsedRow({ lineNumber: 3, phoneDigits: '0555111222', phone: '0555 111 222', productName: 'C' }),
    ] as never);

    expect(groups).toHaveLength(2);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[1].items).toHaveLength(1);
  });

  it('builds deterministic source row ids', () => {
    const row = parsedRow();
    const again = parsedRow();
    expect(row.sourceRowId).toBe(again.sourceRowId);
    expect(row.sourceRowId).toContain('historical-row');
    expect(row.sourceRowId).toContain('L1');
  });

  it('allows partial monthly batch validation without final totals', () => {
    const result = validateHistoricalSalesBatch(SAMPLE_ROW, 'historical-sales.tsv');
    expect(result.totals.validRows).toBe(1);
    expect(result.totals.sourceRows).toBeLessThan(FINAL_EXPECTED_SOURCE_ROWS);
    expect(result.status).toBe('PASS');
  });

  it('passes batch validation with fewer than 1533 rows', () => {
    const content = Array.from({ length: 250 }, (_, i) =>
      `5/14/2026\t0507 535 337\tProduct ${i}\t1.00\t100.00`,
    ).join('\n');
    const result = validateHistoricalSalesBatch(content, 'historical-sales.tsv');
    expect(result.totals.validRows).toBe(250);
    expect(result.status).toBe('PASS');
  });

  it('passes batch validation with fewer than 6555 units', () => {
    const result = validateHistoricalSalesBatch(
      '5/14/2026\t0507 535 337\tProduct A\t10.00\t100.00\n',
      'historical-sales.tsv',
    );
    expect(result.totals.totalQuantity).toBe('10');
    expect(result.status).toBe('PASS');
  });

  it('passes batch validation with sales below final amount', () => {
    const result = validateHistoricalSalesBatch(
      '5/14/2026\t0507 535 337\tProduct A\t1.00\t100.00\n',
      'historical-sales.tsv',
    );
    expect(Number(result.totals.totalAmountKgs)).toBeLessThan(
      Number(FINAL_EXPECTED_TOTAL_AMOUNT_KGS),
    );
    expect(result.status).toBe('PASS');
  });

  it('returns WARNING when some rows are invalid but others are valid', () => {
    const content = [
      '5/14/2026\t0507 535 337\tProduct A\t1.00\t100.00',
      '5/14/2026\t0507 535 337\tProduct B\t\t100.00',
    ].join('\n');
    const result = validateHistoricalSalesBatch(content, 'historical-sales.tsv');
    expect(result.totals.validRows).toBe(1);
    expect(result.totals.invalidRows).toBe(1);
    expect(result.status).toBe('WARNING');
  });

  it('returns ERROR when no valid rows exist', () => {
    const result = validateHistoricalSalesBatch(
      '5/14/2026\t0507 535 337\tProduct B\t\t100.00\n',
      'historical-sales.tsv',
    );
    expect(result.status).toBe('ERROR');
    expect(resolveBatchStatus(result.totals.validRows, result.totals.invalidRows)).toBe('ERROR');
  });

  it('filters already imported rows for duplicate protection', () => {
    const rows = [parsedRow({ lineNumber: 1 }), parsedRow({ lineNumber: 2, productName: 'B' })];
    const imported = new Set([rows[0].sourceRowId]);
    const { newRows, duplicatesSkipped } = filterNewRows(rows as never, imported);
    expect(newRows).toHaveLength(1);
    expect(duplicatesSkipped).toBe(1);
  });

  it('detects duplicate protection on second import of same file content', () => {
    const content = '5/14/2026\t0507 535 337\tProduct A\t1.00\t100.00\n';
    const first = validateHistoricalSalesBatch(content, 'historical-sales.tsv');
    const imported = new Set(first.parsed.map((row) => row.sourceRowId));
    const second = filterNewRows(first.parsed, imported);
    expect(second.newRows).toHaveLength(0);
    expect(second.duplicatesSkipped).toBe(1);
  });

  it('supports adding a new month by keeping old row ids stable', () => {
    const month1 = '5/14/2026\t0507 535 337\tProduct A\t1.00\t100.00\n';
    const month1Parsed = validateHistoricalSalesBatch(month1, 'historical-sales.tsv').parsed;
    const imported = new Set(month1Parsed.map((row) => row.sourceRowId));

    const month1And2 = [
      '5/14/2026\t0507 535 337\tProduct A\t1.00\t100.00',
      '6/14/2026\t0507 535 337\tProduct B\t2.00\t200.00',
    ].join('\n');
    const combined = validateHistoricalSalesBatch(month1And2, 'historical-sales.tsv');
    const { newRows, duplicatesSkipped } = filterNewRows(combined.parsed, imported);

    expect(duplicatesSkipped).toBe(1);
    expect(newRows).toHaveLength(1);
    expect(newRows[0].productName).toBe('Product B');
  });

  it('Test 1: 283-row valid partial batch is PASS with exit 0', () => {
    const content = Array.from({ length: 283 }, (_, i) =>
      `8/1/2026\t0507 535 337\tProduct ${i}\t${i % 5 === 0 ? '10.00' : '4.00'}\t${1000 + i}.00`,
    ).join('\n');
    const result = validateHistoricalSalesBatch(content, 'historical-sales.tsv');
    expect(result.totals.sourceRows).toBe(283);
    expect(result.totals.validRows).toBe(283);
    expect(result.issues).toHaveLength(0);
    expect(result.status).toBe('PASS');
    expect(resolveValidateExitCode(result.status)).toBe(0);
  });

  it('Test 2: partial batch that does not match final totals is PASS not BLOCKED', () => {
    const result = validateHistoricalSalesBatch(
      Array.from({ length: 283 }, (_, i) =>
        `8/1/2026\t0507 535 337\tProduct ${i}\t1.00\t100.00`,
      ).join('\n'),
      'historical-sales.tsv',
    );
    expect(result.totals.sourceRows).not.toBe(FINAL_EXPECTED_SOURCE_ROWS);
    expect(result.totals.totalQuantity).not.toBe(FINAL_EXPECTED_TOTAL_QUANTITY);
    expect(result.totals.totalAmountKgs).not.toBe(FINAL_EXPECTED_TOTAL_AMOUNT_KGS);
    expect(result.status).toBe('PASS');
    expect(result.status).not.toBe('BLOCKED' as never);
    expect(resolveValidateExitCode(result.status)).toBe(0);
  });

  it('Test 3: invalid current row (missing quantity) is non-zero exit', () => {
    const result = validateHistoricalSalesBatch(
      '8/1/2026\t0507 535 337\tProduct A\t\t100.00\n',
      'historical-sales.tsv',
    );
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.status).toBe('ERROR');
    expect(resolveValidateExitCode(result.status)).toBe(1);
  });

  it('Test 4: --final-validate still compares against 1533 / 6555 / 8160605', () => {
    const partial = validateHistoricalSalesBatch(SAMPLE_ROW, 'historical-sales.tsv');
    expect(partial.status).toBe('PASS');

    const finalPartial = validateFinalHistoricalSales(SAMPLE_ROW, 'historical-sales.tsv');
    expect(finalPartial.status).toBe('BLOCKED');
    expect(finalPartial.discrepancies.join(' ')).toContain('1533');
    expect(finalPartial.discrepancies.join(' ')).toContain('6555');
    expect(finalPartial.discrepancies.join(' ')).toContain('8160605');
  });

  it('maps product aliases without changing source names', () => {
    expect(resolveProductName('Аккумулятор 58Ач')).toBe('Chaowei Аккумулятор 58 Ач');
  });

  it('defines walk-in customer constants', () => {
    expect(WALK_IN_CUSTOMER_NAME).toBe('Walk-in Customer');
    expect(WALK_IN_CUSTOMER_PHONE).toBe('walk-in');
  });

  it('parses TSV rows from content', () => {
    const rows = parseHistoricalSalesTsv(SAMPLE_ROW);
    expect(rows).toHaveLength(1);
    expect(rows[0].productName).toBe('Желмаян Контроллер 1,8 кВт 70H');
  });

  it('builds sale group keys from phone and date', () => {
    const row = parsedRow();
    expect(buildSaleGroupKey(row as never)).toBe('2026-05-14|0507535337');
  });

  it('maps Розничный variants to Walk-in Customer without phone lookup', () => {
    for (const value of ['Розничный', 'РОЗНИЧНЫЙ', 'розничный', ' Розничный ']) {
      expect(isRoznichnyCustomer(value)).toBe(true);
      const identity = resolveHistoricalCustomer(value);
      expect(identity).toEqual({
        kind: 'walk-in',
        groupToken: WALK_IN_GROUP_TOKEN,
        lookedUpPhone: false,
      });
    }
  });

  it('groups multiple Розничный rows on the same date into one Sale', () => {
    const content = [
      '5/11/2026\tРозничный\tProduct A\t1.00\t100.00',
      '5/11/2026\tРОЗНИЧНЫЙ\tProduct B\t2.00\t200.00',
      '5/11/2026\t розничный \tProduct C\t3.00\t300.00',
    ].join('\n');
    const result = validateHistoricalSalesBatch(content, 'historical-sales.tsv');
    expect(result.status).toBe('PASS');
    expect(result.issues).toHaveLength(0);
    expect(result.totals.walkInRows).toBe(3);
    expect(result.totals.saleGroups).toBe(1);
    expect(result.groups[0].isWalkIn).toBe(true);
    expect(result.groups[0].items).toHaveLength(3);
  });

  it('creates different Sales for Розничный rows on different dates', () => {
    const content = [
      '5/11/2026\tРозничный\tProduct A\t1.00\t100.00',
      '6/11/2026\tРозничный\tProduct B\t1.00\t100.00',
    ].join('\n');
    const result = validateHistoricalSalesBatch(content, 'historical-sales.tsv');
    expect(result.totals.saleGroups).toBe(2);
    expect(result.groups.every((group) => group.isWalkIn)).toBe(true);
  });

  it('keeps phone customers grouped separately from Розничный', () => {
    const content = [
      '5/11/2026\t0554 016 142\tProduct A\t1.00\t100.00',
      '5/11/2026\tРозничный\tProduct B\t1.00\t100.00',
    ].join('\n');
    const result = validateHistoricalSalesBatch(content, 'historical-sales.tsv');
    expect(result.totals.saleGroups).toBe(2);
    expect(result.totals.walkInRows).toBe(1);
    const phoneIdentity = resolveHistoricalCustomer('0554 016 142');
    expect(phoneIdentity.kind).toBe('phone');
    expect(phoneIdentity.lookedUpPhone).toBe(true);
  });

  it('maps unknown phones to Walk-in grouping token only after phone lookup fails in import', () => {
    const identity = resolveHistoricalCustomer('0704002983');
    expect(identity.kind).toBe('phone');
    if (identity.kind === 'phone') {
      expect(identity.phoneDigits).toBe('0704002983');
    }
  });

  it('does not create a Розничный customer identity', () => {
    expect(resolveHistoricalCustomer('Розничный').kind).toBe('walk-in');
    expect(WALK_IN_CUSTOMER_NAME).not.toBe('Розничный');
    expect(WALK_IN_CUSTOMER_PHONE).toBe('walk-in');
  });

  it('treats cash-paid walk-in rows as valid historical retail sales', () => {
    const result = validateHistoricalSalesBatch(
      '5/11/2026\tРозничный\tProduct A\t1.00\t1594.00\n',
      'historical-sales.tsv',
    );
    expect(result.status).toBe('PASS');
    expect(result.parsed[0].unitPriceKgs.toFixed(2)).toBe('1594.00');
    expect(result.parsed[0].isWalkIn).toBe(true);
  });

  it('keeps Розничный row ids stable across re-import', () => {
    const content = '5/11/2026\tРозничный\tProduct A\t1.00\t100.00\n';
    const first = validateHistoricalSalesBatch(content, 'historical-sales.tsv');
    const second = filterNewRows(
      first.parsed,
      new Set(first.parsed.map((row) => row.sourceRowId)),
    );
    expect(second.newRows).toHaveLength(0);
    expect(second.duplicatesSkipped).toBe(1);
  });
});
