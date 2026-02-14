'use client';
import React, { useCallback, useMemo } from 'react';
import { getAssetColor } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import { PlotlyChart as Plot } from '@/components/charts/plotly/PlotlyChart';
import { sliceStartIndexForIsoDates, sampleDataWithDates } from '@/lib/timeframe';
import { useDashboardData } from '../../DashboardDataProvider';
import { useAutoSelectAsset } from '../lib/use-auto-select-asset';
import type { Layout, Data } from 'plotly.js';

export function PositionsChart() {
  const { txs, assets, dailyPos, notesByDayAsset, loadingTxs } = useDashboardData();

  const [selectedAsset, setSelectedAsset] = useAutoSelectAsset(assets);
  const colorFor = useCallback((asset: string): string => getAssetColor(asset), []);

  const positionsFigure = useMemo(() => {
    const groups = new Map<string, { x: string[]; y: number[] }>();
    for (const r of dailyPos) {
      const g = groups.get(r.asset) || { x: [], y: [] };
      g.x.push(r.date); g.y.push(r.position);
      groups.set(r.asset, g);
    }

    const data: Data[] = ((() => {
      if (selectedAsset && groups.has(selectedAsset)) {
        const g = groups.get(selectedAsset)!;
        const text = g.x.map(d => notesByDayAsset.get(`${d}|${selectedAsset}`) || '');
        return [{
          x: g.x,
          y: g.y,
          type: 'scatter',
          mode: 'lines+markers',
          name: selectedAsset,
          line: { shape: 'hv', color: colorFor(selectedAsset) },
          marker: { size: 5, color: colorFor(selectedAsset) },
          text,
          hovertemplate: `%{x}<br>Position: %{y}<br>%{text}<extra></extra>`,
        } as Data];
      }
      return Array.from(groups.entries()).map(([asset, g]) => {
        const text = g.x.map(d => notesByDayAsset.get(`${d}|${asset}`) || '');
        const c = colorFor(asset);
        return ({
          x: g.x,
          y: g.y,
          type: 'scatter',
          mode: 'lines+markers',
          name: asset,
          line: { shape: 'hv', color: c },
          marker: { size: 5, color: c },
          text,
          hovertemplate: `%{x}<br>Position: %{y}<br>%{text}<extra></extra>`,
        } as Data);
      });
    })());
    const layout: Partial<Layout> = { autosize: true, height: 320, margin: { t: 30, r: 10, l: 40, b: 40 }, legend: { orientation: 'h' } };
    const result = { data, layout };
    return result;
  }, [dailyPos, selectedAsset, colorFor, notesByDayAsset]);

  return (
    <ChartCard
      title="Asset Positions Over Time"
      headerActions={() => (
        <label className="chart-control">
          Asset
          <select value={selectedAsset} onChange={e => setSelectedAsset(e.target.value)}>
            <option value="">All Assets</option>
            {assets.map(a => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
      )}
    >
      {({ timeframe, expanded }) => {
        if (loadingTxs || !txs) {
          return <div className="chart-loading">Loading positions...</div>;
        }
        if (!positionsFigure.data.length) {
          return <div className="chart-empty">No position data</div>;
        }
        const firstTrace = positionsFigure.data[0] as { x?: string[]; y?: number[] } | undefined;
        const idx = firstTrace?.x
          ? sliceStartIndexForIsoDates(firstTrace.x, timeframe)
          : 0;
        const slicedData = positionsFigure.data.map(trace => {
          const t = trace as { x?: string[]; y?: number[]; [key: string]: unknown };
          return {
            ...trace,
            x: t.x ? t.x.slice(idx) : [],
            y: t.y ? t.y.slice(idx) : [],
          } as Data;
        });

        // Sample data points for performance (max 100 points per trace)
        const maxPoints = expanded ? 200 : 100;
        const sampledData = slicedData.map(trace => {
          const t = trace as { x?: string[]; y?: number[]; [key: string]: unknown };
          if (!t.x || !t.y || t.x.length <= maxPoints) return trace;
          const sampled = sampleDataWithDates(t.x, t.y, maxPoints);
          return {
            ...trace,
            x: sampled.dates,
            y: sampled.data,
          } as Data;
        });
        return (
          <Plot
            data={sampledData}
            layout={{
              ...positionsFigure.layout,
              height: expanded ? undefined : 320,
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
            }}
            style={{ width: '100%', height: expanded ? '100%' : undefined }}
          />
        );
      }}
    </ChartCard>
  );
}
