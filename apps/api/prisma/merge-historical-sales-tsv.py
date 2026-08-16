#!/usr/bin/env python3
"""Merge historical-sales.tsv with historical-sales-additions.txt."""
from __future__ import annotations

import re
from pathlib import Path

DATE_NEW = re.compile(
    r'^(\d{1,2}/\d{1,2}/\d{4})\t(.+)\t([\d.,]+)\t([\d.,]+)\t(.+)\s*$'
)


def parse_date(value: str) -> tuple[int, int, int]:
    month, day, year = value.split('/')
    return int(year), int(month), int(day)


def load_rows(path: Path) -> dict[tuple[str, str, str, str, str], str]:
    rows: dict[tuple[str, str, str, str, str], str] = {}
    if not path.exists():
        return rows
    for line in path.read_text(encoding='utf-8').splitlines():
        match = DATE_NEW.match(line.strip())
        if not match:
            continue
        key = match.groups()
        rows[key] = '\t'.join(key)
    return rows


def main() -> None:
    data_dir = Path(__file__).parent / 'data'
    base = data_dir / 'historical-sales.tsv'
    additions = data_dir / 'historical-sales-additions.txt'

    rows = load_rows(base)
    before = len(rows)
    rows.update(load_rows(additions))
    added = len(rows) - before

    sorted_keys = sorted(rows.keys(), key=lambda key: (parse_date(key[0]), key[4], key[1]))
    output = '\n'.join(rows[key] for key in sorted_keys) + '\n'
    base.write_text(output, encoding='utf-8')

    roznichny = sum(1 for key in sorted_keys if key[4] == 'Розничный')
    print(f'Merged {len(sorted_keys)} rows (+{added} new) into {base}')
    print(f'Розничный rows: {roznichny}')
    print(f'Date range: {sorted_keys[0][0]} -> {sorted_keys[-1][0]}')


if __name__ == '__main__':
    main()
