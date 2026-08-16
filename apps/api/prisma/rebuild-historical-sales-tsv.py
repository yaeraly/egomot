#!/usr/bin/env python3
"""Rebuild historical-sales.tsv in DATE\\tCUSTOMER\\tPRODUCT\\tQTY\\tPRICE format."""
from __future__ import annotations

import re
import sys
from pathlib import Path

DATA_DIR = Path(__file__).parent / 'data'
OUT = DATA_DIR / 'historical-sales.tsv'
SOURCES = [
    DATA_DIR / 'historical-sales-source.txt',
    DATA_DIR / 'historical-sales-5-11-12.txt',
    DATA_DIR / 'historical-sales-5-13.txt',
    DATA_DIR / 'historical-sales-git-723a5df.tsv',
    DATA_DIR / 'historical-sales-additions.txt',
]

SKIP_PRODUCTS = {'Товар'}
RETAIL = 'Розничный'

# Old merged format: DATE PRODUCT QTY PRICE CUSTOMER
OLD = re.compile(
    r'^(\d{1,2}/\d{1,2}/\d{4})\t(.+)\t([\d.,]+)\t([\d.,]+)\t(.+)\s*$'
)
# Source format: DATE CUSTOMER PRODUCT QTY PRICE
NEW = re.compile(
    r'^(\d{1,2}/\d{1,2}/\d{4})\t(.+)\t(.+)\t([\d.,]*)\t([\d.,]+)\s*$'
)


def parse_date(value: str) -> tuple[int, int, int]:
    month, day, year = value.split('/')
    return int(year), int(month), int(day)


def normalize_qty(value: str) -> str:
    return value.strip().replace(',', '')


def normalize_price(value: str) -> str:
    return value.strip().replace(',', '')


def add_row(
    rows: dict[tuple[str, str, str, str, str], str],
    date: str,
    customer: str,
    product: str,
    qty: str,
    price: str,
    source: str,
    line_no: int,
    skipped: list[str],
) -> None:
    customer = customer.strip()
    product = product.strip()
    qty = normalize_qty(qty)
    price = normalize_price(price)

    if product in SKIP_PRODUCTS:
        skipped.append(f'{source}:{line_no}: placeholder product')
        return
    if not qty:
        skipped.append(f'{source}:{line_no}: empty quantity ({product}, {customer})')
        return
    if not price:
        skipped.append(f'{source}:{line_no}: empty price ({product}, {customer})')
        return

    key = (date, customer, product, qty, price)
    rows[key] = '\t'.join(key)


def load_file(path: Path, rows: dict, skipped: list[str]) -> int:
    if not path.exists():
        return 0
    before = len(rows)
    for line_no, raw in enumerate(path.read_text(encoding='utf-8').splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith('ДАТА') or 'КОЛИЧ' in line or line.startswith('```'):
            continue

        new_match = NEW.match(line)
        if new_match:
            date, customer, product, qty, price = new_match.groups()
            add_row(rows, date, customer, product, qty, price, path.name, line_no, skipped)
            continue

        old_match = OLD.match(line)
        if old_match:
            date, product, qty, price, customer = old_match.groups()
            add_row(rows, date, customer, product, qty, price, path.name, line_no, skipped)
            continue

        skipped.append(f'{path.name}:{line_no}: unrecognized format')
    return len(rows) - before


def main() -> None:
    rows: dict[tuple[str, str, str, str, str], str] = {}
    skipped: list[str] = []

    for source in SOURCES:
        added = load_file(source, rows, skipped)
        print(f'{source.name}: +{added} rows (total {len(rows)})')

    sorted_keys = sorted(rows.keys(), key=lambda key: (parse_date(key[0]), key[1], key[2]))
    OUT.write_text('\n'.join(rows[key] for key in sorted_keys) + '\n', encoding='utf-8')

    roznichny = sum(1 for key in sorted_keys if key[1] == RETAIL)
    phones = {key[1] for key in sorted_keys if key[1] != RETAIL}

    print(f'\nWrote {len(sorted_keys)} rows to {OUT}')
    print(f'Розничный rows: {roznichny}')
    print(f'Unique phone customers: {len(phones)}')
    print(f'Date range: {sorted_keys[0][0]} -> {sorted_keys[-1][0]}')
    print(f'Skipped {len(skipped)} lines')
    for item in skipped:
        print(f'  {item}')


if __name__ == '__main__':
    main()
