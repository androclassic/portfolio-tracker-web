export type ChartX = string | number | Date;

export type LineSeries = {
  id?: string;
  name: string;
  y: number[];
  /**
   * Optional override. If omitted, the chart-level x axis is used.
   */
  x?: ChartX[];
  color?: string;
  width?: number;
  dash?: 'solid' | 'dash' | 'dot' | 'dashdot';
  /**
   * Fill options are intentionally conservative; adapters can map them as needed.
   */
  fill?: 'none' | 'tozeroy' | 'tonexty';
  fillColor?: string;
};

export type LineChartModel = {
  title?: string;
  x: ChartX[];
  series: LineSeries[];
  xAxisTitle?: string;
  yAxisTitle?: string;
  height?: number;
  hovermode?: 'x unified' | 'closest' | 'x';
};

export type PieSlice = {
  id?: string;
  label: string;
  value: number;
  color?: string;
  /**
   * Optional extra info for hover/tooltips.
   */
  meta?: Record<string, unknown>;
};

export type PieChartModel = {
  title?: string;
  slices: PieSlice[];
  hole?: number;
  height?: number;
};


