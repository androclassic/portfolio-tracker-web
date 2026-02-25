'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { usePlotlyTheme } from './usePlotlyTheme';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

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

export type PlotlyChartProps = {
  data: unknown;
  layout?: unknown;
  config?: unknown;
  style?: React.CSSProperties;
  className?: string;
  onClick?: (event: unknown) => void;
  onHover?: (event: unknown) => void;
  onUnhover?: (event: unknown) => void;
  onLegendClick?: (event: unknown) => boolean | void;
  onLegendDoubleClick?: (event: unknown) => boolean | void;
  /**
   * Show Plotly modebar. Defaults to true to enable zoom/pan controls.
   * Set to false to hide the modebar.
   */
  showModeBar?: boolean;
};

/**
 * Plotly adapter wrapper. Centralizes the dynamic import so pages/components don't
 * depend on `next/dynamic` or `react-plotly.js` directly.
 */
export function PlotlyChart({
  data,
  layout,
  config,
  style,
  className,
  onClick,
  onHover,
  onUnhover,
  onLegendClick,
  onLegendDoubleClick,
  showModeBar = false,
}: PlotlyChartProps) {
  const theme = usePlotlyTheme();

  const mergedLayout = useMemo(() => {
    const user = isPlainObject(layout) ? layout : {};
    return mergeDeep(theme.layoutDefaults, user);
  }, [theme.layoutDefaults, layout]);

  const mergedConfig = useMemo(() => {
    const user = isPlainObject(config) ? config : {};
    const base = theme.configDefaults;
    const merged = mergeDeep(base, user);
    merged.displayModeBar = showModeBar;
    
    // Configure modebar buttons - show only essential ones
    if (showModeBar) {
      merged.modeBarButtonsToRemove = [
        'zoom2d',
        'pan2d',
        'lasso2d',
        'select2d',
        'zoomIn2d',
        'zoomOut2d',
        'resetScale2d',
        'hoverClosestCartesian',
        'hoverCompareCartesian',
        'toggleHover',
        'toImage',
      ];
      // Keep only: autoScale2d (autofit/zoom out)
    }
    
    return merged;
  }, [theme.configDefaults, config, showModeBar]);

  return (
    <Plot
      data={data as never}
      layout={mergedLayout as never}
      config={mergedConfig as never}
      useResizeHandler={true as never}
      style={{ width: '100%', ...style }}
      className={className}
      onClick={onClick as never}
      onHover={onHover as never}
      onUnhover={onUnhover as never}
      onLegendClick={onLegendClick as never}
      onLegendDoubleClick={onLegendDoubleClick as never}
    />
  );
}


