'use client';

import React from 'react';

export type ShortTimeframe = '24h' | '7d' | '30d';

export const SHORT_TIMEFRAMES: Array<{ value: ShortTimeframe; label: string }> = [
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
];

export function ShortTimeframeSelector(props: {
  value: ShortTimeframe;
  onChange: (v: ShortTimeframe) => void;
}) {
  return (
    <div className="segmented" aria-label="Timeframe">
      {SHORT_TIMEFRAMES.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={props.value === opt.value ? 'active' : ''}
          onClick={() => props.onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

