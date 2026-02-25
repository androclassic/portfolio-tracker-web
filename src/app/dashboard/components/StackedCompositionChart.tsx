'use client';
import React, { useState, useMemo, useCallback } from 'react';
import { getAssetColor, isFiatCurrency } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import { PlotlyChart as Plot } from '@/components/charts/plotly/PlotlyChart';
import { sliceStartIndexForIsoDates, sampleDataWithDates } from '@/lib/timeframe';
import { useDashboardData } from '../../DashboardDataProvider';
import type { Data } from 'plotly.js';

export function StackedCompositionChart() {
  const { assets, stacked, loadingTxs, loadingCurr, loadingHist } = useDashboardData();

  const [stackedMode, setStackedMode] = useState<'usd' | 'percent'>('usd');

  const colorFor = useCallback((asset: string): string => getAssetColor(asset), []);
  const isLoading = loadingTxs || loadingCurr || loadingHist;

  return (
    <ChartCard
      title="Portfolio Composition Over Time"
      headerActions={() => (
        <label className="chart-control">
          Mode
          <select value={stackedMode} onChange={e => setStackedMode(e.target.value as 'usd' | 'percent')}>
            <option value="usd">USD</option>
            <option value="percent">Percent</option>
          </select>
        </label>
      )}
    >
      {({ timeframe, expanded }) => {
        if (isLoading) {
          return <div className="chart-loading">Loading portfolio composition...</div>;
        }
        if (!stacked.dates.length) {
          return <div className="chart-empty">No portfolio composition data</div>;
        }

        const idx = sliceStartIndexForIsoDates(stacked.dates, timeframe);
        const dates = stacked.dates.slice(idx);

        // Sample data points for performance (max 100 points per trace)
        const maxPoints = expanded ? 200 : 100;
        const sampledDates = sampleDataWithDates(dates, dates, maxPoints).dates;

        // Filter out fiat currencies from the stacked chart
        const cryptoAssets = Array.from(stacked.perAssetUsd.keys()).filter(asset => !isFiatCurrency(asset));
        const traces = cryptoAssets.map(asset => {
          const usdValues = stacked.perAssetUsd.get(asset) || [];
          const unitValues = (stacked.perAssetUnits.get(asset) || []).slice(idx);
          const yData = stackedMode === 'usd'
            ? usdValues.slice(idx)
            : usdValues.slice(idx).map((value, i) => {
                const total = stacked.totals[i + idx] || 1;
                return total > 0 ? (value / total) * 100 : 0;
              });

          const sampled = sampleDataWithDates(dates, yData, maxPoints);
          const sampledY = sampled.data;
          const sampledUnits = sampleDataWithDates(dates, unitValues, maxPoints).data;

          const hovertemplate = stackedMode === 'usd'
            ? `${asset}: %{y:,.2f} USD (%{customdata:.8g} ${asset})<extra></extra>`
            : `${asset}: %{y:.2f}% (%{customdata:.8g} ${asset})<extra></extra>`;

          return {
            x: sampledDates,
            y: sampledY,
            customdata: sampledUnits,
            type: 'scatter' as const,
            mode: 'lines' as const,
            stackgroup: 'one',
            name: asset,
            line: { color: colorFor(asset) },
            hovertemplate,
          };
        });

        return (
          <Plot
            data={traces as Data[]}
            layout={{
              autosize: true,
              height: expanded ? undefined : 400,
              margin: { t: 30, r: 10, l: 50, b: 30 },
              hovermode: 'x unified',
              paper_bgcolor: 'transparent',
              plot_bgcolor: 'transparent',
              yaxis: {
                title: { text: stackedMode === 'usd' ? 'USD Value' : 'Percentage' },
              },
              legend: {
                orientation: 'h',
                y: -0.2,
              },
            }}
            style={{ width: '100%', height: expanded ? '100%' : undefined }}
          />
        );
      }}
    </ChartCard>
  );
}
