'use client';

import React, { useMemo } from 'react';
import type { EChartsOption } from 'echarts';
import type { PieChartModel, PieSlice } from './types';
import { EChart } from './echarts';

export type PieChartProps = {
  model: PieChartModel;
  getHoverText?: (slice: PieSlice) => string;
  textinfo?: 'none' | 'label' | 'percent' | 'label+percent' | 'label+value' | 'label+percent+value';
  style?: React.CSSProperties;
};

export function PieChart({ model, getHoverText, textinfo = 'label+percent', style }: PieChartProps) {
  const option = useMemo((): EChartsOption => {
    const data = model.slices.map((s) => ({
      name: s.label,
      value: s.value,
      itemStyle: s.color ? { color: s.color } : undefined,
      _slice: s,
    }));

    const showLabel = textinfo !== 'none';

    const labelFormatter = (params: { name: string; percent: number; value: number }) => {
      switch (textinfo) {
        case 'label': return params.name;
        case 'percent': return `${params.percent}%`;
        case 'label+value': return `${params.name}\n${params.value.toLocaleString()}`;
        case 'label+percent+value': return `${params.name}\n${params.percent}%`;
        case 'label+percent':
        default: return `${params.name} ${params.percent}%`;
      }
    };

    const hole = typeof model.hole === 'number' ? model.hole : 0;
    const innerRadius = hole > 0 ? `${Math.round(hole * 100)}%` : '0%';

    return {
      xAxis: { show: false },
      yAxis: { show: false },
      grid: { show: false, left: 0, right: 0, top: 0, bottom: 0 },
      tooltip: {
        trigger: 'item',
        formatter: getHoverText
          ? (params: unknown) => {
              const p = params as { data: { _slice: PieSlice } };
              return getHoverText(p.data._slice);
            }
          : undefined,
      },
      legend: { show: false },
      series: [
        {
          type: 'pie',
          radius: [innerRadius, '75%'],
          data,
          label: {
            show: showLabel,
            position: 'inside',
            formatter: labelFormatter as never,
            fontSize: 11,
            color: '#fff',
          },
          emphasis: {
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0,0,0,0.3)' },
          },
          animationType: 'scale',
          animationEasing: 'elasticOut',
        },
      ],
    };
  }, [model, getHoverText, textinfo]);

  if (!model.slices.length) return null;

  return (
    <EChart
      option={option}
      style={{ width: '100%', height: model.height ?? 320, ...style }}
    />
  );
}
