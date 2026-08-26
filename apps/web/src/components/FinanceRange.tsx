'use client';

import { useMemo, useState } from 'react';
import { DateRangeFilter, defaultCustomRange } from '@/components/DateRangeFilter';
import { DatePresetValue } from '@/lib/date';

export function useFinanceQuery(defaultPreset: DatePresetValue = 'month') {
  const [preset, setPreset] = useState<DatePresetValue>(defaultPreset);
  const [{ from, to }, setRange] = useState(defaultCustomRange());

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (preset === 'custom') {
      if (from) params.set('from', from);
      if (to) params.set('to', to);
    } else {
      params.set('preset', preset);
    }
    return params.toString() ? `?${params}` : '';
  }, [preset, from, to]);

  return {
    preset,
    from,
    to,
    query,
    setPreset,
    setFrom: (value: string) => setRange((s) => ({ ...s, from: value })),
    setTo: (value: string) => setRange((s) => ({ ...s, to: value })),
  };
}

export function FinanceRangeBar({
  preset,
  from,
  to,
  setPreset,
  setFrom,
  setTo,
}: {
  preset: DatePresetValue;
  from: string;
  to: string;
  setPreset: (value: DatePresetValue) => void;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
}) {
  return (
    <DateRangeFilter
      preset={preset}
      from={from}
      to={to}
      onPresetChange={setPreset}
      onFromChange={setFrom}
      onToChange={setTo}
    />
  );
}
