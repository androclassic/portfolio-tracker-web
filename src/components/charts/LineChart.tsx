'use client';

import React, { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import type { LineChartModel } from './types';
import { EChart } from './echarts';

export type LineChartProps = {
  model: LineChartModel;
  style?: React.CSSProperties;
};

const DASH_MAP: Record<string, string> = {
  solid: 'solid',
  dash: 'dashed',
  dot: 'dotted',
  dashdot: 'dashed',
};

export function LineChart({ model, style }: LineChartProps) {
  const option = useMemo((): EChartsOption => {
    const xData = model.x.map((v) => (v instanceof Date ? v.toISOString() : v));

    const series = model.series.map((s) => {
      const seriesX = s.x ? s.x.map((v) => (v instanceof Date ? v.toISOString() : v)) : xData;
      const hasFill = s.fill && s.fill !== 'none';
      const dashType = (DASH_MAP[s.dash ?? 'solid'] ?? 'solid') as 'solid' | 'dashed' | 'dotted';

      return {
        type: 'line' as const,
        name: s.name,
        data: s.y.map((yVal, i) => [seriesX[i], yVal]),
        lineStyle: {
          color: s.color,
          width: s.width ?? 2,
          type: dashType,
        },
        itemStyle: s.color ? { color: s.color } : undefined,
        areaStyle: hasFill ? { color: s.fillColor, opacity: 0.15 } : undefined,
        showSymbol: false,
        smooth: false,
      };
    });

    return {
      xAxis: {
        type: 'category',
        data: xData as string[],
        axisLabel: { show: true },
      },
      yAxis: {
        type: 'value',
        name: model.yAxisTitle,
      },
      series,
      tooltip: {
        trigger: model.hovermode === 'closest' ? 'item' : 'axis',
      },
      legend: {
        show: model.series.length > 1,
      },
    };
  }, [model]);

  if (!model.series.length) return null;

  return (
    <EChart
      option={option}
      style={{ width: '100%', height: model.height ?? 400, ...style }}
    />
  );
}
