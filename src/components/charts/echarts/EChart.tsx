'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import type { EChartsOption } from 'echarts';
import { useEChartsTheme } from './useEChartsTheme';

const ReactECharts = dynamic(() => import('echarts-for-react'), { ssr: false });

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function mergeDeep(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    const prev = out[k];
    if (isPlainObject(prev) && isPlainObject(v)) out[k] = mergeDeep(prev, v);
    else out[k] = v;
  }
  return out;
}

export type EChartProps = {
  option: EChartsOption;
  style?: React.CSSProperties;
  className?: string;
  onEvents?: Record<string, (params: unknown) => void>;
  showToolbox?: boolean;
  notMerge?: boolean;
};

export function EChart({
  option,
  style,
  className,
  onEvents,
  showToolbox = false,
  notMerge = false,
}: EChartProps) {
  const theme = useEChartsTheme();

  const mergedOption = useMemo(() => {
    const base = theme as Record<string, unknown>;
    const user = (option ?? {}) as Record<string, unknown>;
    const merged = mergeDeep(base, user);

    if (!showToolbox) {
      merged.toolbox = { show: false };
    }

    return merged as EChartsOption;
  }, [theme, option, showToolbox]);

  return (
    <ReactECharts
      option={mergedOption}
      style={{ width: '100%', height: '400px', ...style }}
      className={className}
      onEvents={onEvents}
      notMerge={notMerge}
      opts={{ renderer: 'canvas' }}
    />
  );
}
