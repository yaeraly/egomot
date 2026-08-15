'use client';

import { DATE_PRESETS, DatePresetValue, todayInputValue } from '@/lib/date';
import { Field, Input, Select } from './ui';

export function DateRangeFilter({
  preset,
  from,
  to,
  onPresetChange,
  onFromChange,
  onToChange,
}: {
  preset: DatePresetValue;
  from: string;
  to: string;
  onPresetChange: (value: DatePresetValue) => void;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Field label="Период">
        <Select value={preset} onChange={(e) => onPresetChange(e.target.value as DatePresetValue)}>
          {DATE_PRESETS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </Select>
      </Field>
      {preset === 'custom' ? (
        <>
          <Field label="С">
            <Input type="date" value={from} onChange={(e) => onFromChange(e.target.value)} />
          </Field>
          <Field label="По">
            <Input type="date" value={to} onChange={(e) => onToChange(e.target.value)} />
          </Field>
        </>
      ) : (
        <div className="sm:col-span-2 flex items-end">
          <p className="text-sm text-muted">Фильтрация по фактической бизнес-дате, не по дате ввода в систему.</p>
        </div>
      )}
    </div>
  );
}

export function defaultCustomRange() {
  const to = todayInputValue();
  const fromDate = new Date();
  fromDate.setDate(fromDate.getDate() - 30);
  return { from: todayInputValue(fromDate), to };
}
