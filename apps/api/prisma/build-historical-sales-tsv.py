#!/usr/bin/env python3
"""Build historical-sales.tsv from historical-sales-source.txt (raw paste from task)."""
import re
import sys
from pathlib import Path

SOURCE = Path(__file__).parent / 'data' / 'historical-sales-source.txt'
OUT = Path(__file__).parent / 'data' / 'historical-sales.tsv'

DATE_ROW = re.compile(
    r'^(\d{1,2}/\d{1,2}/\d{4})\t(.+)\t([\d.,]+)\t([\d.,]+)\t(.+)$'
)


def main() -> None:
    if not SOURCE.exists():
        print(f'Missing source file: {SOURCE}', file=sys.stderr)
        sys.exit(1)

    rows: list[str] = []
    skipped: list[str] = []

    for line_no, raw in enumerate(SOURCE.read_text(encoding='utf-8').splitlines(), 1):
        line = raw.strip()
        if not line:
            continue
        if line.startswith('ДАТА') or 'КОЛИЧ' in line or line.startswith('```'):
            continue

        m = DATE_ROW.match(line)
        if not m:
            skipped.append(f'line {line_no}: bad format')
            continue

        date, product, qty, price, customer = m.groups()
        product = product.strip()
        customer = customer.strip()
        qty = qty.strip().replace(',', '')
        price = price.strip().replace(',', '')

        if product == 'Товар':
            skipped.append(f'line {line_no}: placeholder product')
            continue
        if not qty:
            skipped.append(f'line {line_no}: empty quantity ({product})')
            continue
        if not price:
            skipped.append(f'line {line_no}: empty price ({product})')
            continue

        rows.append(f'{date}\t{product}\t{qty}\t{price}\t{customer}')

    OUT.write_text('\n'.join(rows) + ('\n' if rows else ''), encoding='utf-8')

    rozn = sum(1 for r in rows if r.endswith('\tРозничный'))
    phones = {r.rsplit('\t', 1)[-1] for r in rows if not r.endswith('\tРозничный')}
    dates = [r.split('\t', 1)[0] for r in rows]

    print(f'Wrote {len(rows)} rows to {OUT}')
    print(f'Skipped {len(skipped)} lines')
    for s in skipped:
        print(f'  {s}')
    print(f'Розничный rows: {rozn}')
    print(f'Unique phone customers: {len(phones)}')
    if dates:
        print(f'Date range: {min(dates)} -> {max(dates)}')


if __name__ == '__main__':
    main()
