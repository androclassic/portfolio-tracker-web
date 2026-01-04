import React, { useMemo } from 'react';
import type { PieChartModel, PieSlice } from './types';
import { PlotlyChart } from './plotly/PlotlyChart';

export type PieChartProps = {
  model: PieChartModel;
  /**
   * Optional hover renderer. Return plain text or HTML (Plotly will render `<br>`).
   */
  getHoverText?: (slice: PieSlice) => string;
  /**
   * Defaults to hiding labels; consumers can override.
   */
  textinfo?: 'none' | 'label' | 'percent' | 'label+percent' | 'label+value' | 'label+percent+value';
};

export function PieChart({ model, getHoverText, textinfo = 'none' }: PieChartProps) {
  const { data, layout } = useMemo(() => {
    const labels = model.slices.map((s) => s.label);
    const values = model.slices.map((s) => s.value);
    const colors = model.slices.map((s) => s.color).filter(Boolean);

    const text = getHoverText ? model.slices.map((s) => getHoverText(s)) : undefined;

    const trace = {
      type: 'pie',
      labels,
      values,
      hole: typeof model.hole === 'number' ? model.hole : 0,
      text,
      hovertemplate: text ? '%{text}<extra></extra>' : undefined,
      textinfo,
      marker: colors.length === model.slices.length ? { colors } : undefined,
    };

    const layout = {
      title: model.title ? { text: model.title } : undefined,
      autosize: true,
      height: model.height,
      margin: { t: model.title ? 40 : 30, r: 10, l: 10, b: 10 },
    };

    return { data: [trace], layout };
  }, [model, getHoverText, textinfo]);

  if (!model.slices.length) return null;

  return <PlotlyChart data={data} layout={layout} style={{ width: '100%' }} />;
}


