import React from 'react';
import dynamic from 'next/dynamic';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

export type PlotlyChartProps = {
  data: unknown;
  layout?: unknown;
  config?: unknown;
  style?: React.CSSProperties;
  className?: string;
  onClick?: (event: unknown) => void;
};

/**
 * Plotly adapter wrapper. Centralizes the dynamic import so pages/components don't
 * depend on `next/dynamic` or `react-plotly.js` directly.
 */
export function PlotlyChart({ data, layout, config, style, className, onClick }: PlotlyChartProps) {
  return (
    <Plot
      data={data as never}
      layout={layout as never}
      config={config as never}
      style={style}
      className={className}
      onClick={onClick as never}
    />
  );
}


