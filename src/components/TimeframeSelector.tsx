'use client';

import React from 'react';
import type { DashboardTimeframe } from '@/lib/timeframe';
import { DASHBOARD_TIMEFRAMES } from '@/lib/timeframe';

export function TimeframeSelector(props: {
  value: DashboardTimeframe;
  onChange: (v: DashboardTimeframe) => void;
}) {
  return (
    <div className="segmented" aria-label="Timeframe">
      {DASHBOARD_TIMEFRAMES.map((opt) => (
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


