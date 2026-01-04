'use client';

import React, { useMemo } from 'react';
import type { LineChartModel } from './types';
import { PlotlyChart } from './plotly/PlotlyChart';

export type LineChartProps = {
  model: LineChartModel;
  style?: React.CSSProperties;
};

export function LineChart({ model, style }: LineChartProps) {
  const { data, layout } = useMemo(() => {
    const traces = model.series.map((s) => {
      return {
        type: 'scatter',
        mode: 'lines',
        name: s.name,
        x: s.x ?? model.x,
        y: s.y,
        line: {
          color: s.color,
          width: s.width,
          dash: s.dash,
        },
        fill: s.fill && s.fill !== 'none' ? s.fill : undefined,
        fillcolor: s.fillColor,
      };
    });

    const layout = {
      title: model.title ? { text: model.title } : undefined,
      xaxis: model.xAxisTitle ? { title: { text: model.xAxisTitle } } : undefined,
      yaxis: model.yAxisTitle ? { title: { text: model.yAxisTitle } } : undefined,
      height: model.height,
      hovermode: model.hovermode,
      showlegend: true,
    };

    return { data: traces, layout };
  }, [model]);

  if (!model.series.length) return null;

  return <PlotlyChart data={data} layout={layout} style={{ width: '100%', ...style }} />;
}


