'use client';
import React, { useCallback, useMemo } from 'react';
import { getAssetColor } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import { PlotlyChart as Plot } from '@/components/charts/plotly/PlotlyChart';
import { sliceStartIndexForIsoDates, sampleDataWithDates } from '@/lib/timeframe';
import { useDashboardData } from '../../DashboardDataProvider';
import { useAutoSelectAsset } from '../lib/use-auto-select-asset';
import { buildAssetSwapPnlSeries } from '@/lib/portfolio-engine';
import type { Data } from 'plotly.js';

export function PnLChart() {
  const { txs, assets, historicalPrices, loadingTxs, pnlData } = useDashboardData();

  const [selectedPnLAsset, setSelectedPnLAsset] = useAutoSelectAsset(assets);
  const colorFor = useCallback((asset: string): string => getAssetColor(asset), []);

  const pnlSeriesByAsset = useMemo(() => {
    const result = new Map<string, { dates: string[]; values: number[] }>();
    if (!txs || txs.length === 0 || assets.length === 0 || historicalPrices.length === 0) {
      return result;
    }

    for (const asset of assets) {
      const series = buildAssetSwapPnlSeries(txs, historicalPrices, asset);
      if (!series.dates.length) continue;
      result.set(asset, {
        dates: series.dates,
        values: series.realized.map((realized, i) => realized + (series.unrealized[i] || 0)),
      });
    }
    return result;
  }, [assets, historicalPrices, txs]);

  const chartDates = useMemo(() => {
    const first = pnlSeriesByAsset.values().next().value as { dates: string[] } | undefined;
    if (first?.dates?.length) return first.dates;
    return Array.from(new Set(historicalPrices.map(p => p.date))).sort();
  }, [historicalPrices, pnlSeriesByAsset]);

  return (
    <ChartCard
      title="Profit & Loss"
      headerActions={() => (
        <label className="chart-control">
          Asset
          <select value={selectedPnLAsset} onChange={e => setSelectedPnLAsset(e.target.value)}>
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
          return <div className="chart-loading">Loading P&L data...</div>;
        }
        if (!chartDates.length) {
          return <div className="chart-empty">No P&L data</div>;
        }

        const idx = sliceStartIndexForIsoDates(chartDates, timeframe);
        const dates = chartDates.slice(idx);

        // Sample data points for performance (max 100 points per trace)
        const maxPoints = expanded ? 200 : 100;
        const sampledDates = sampleDataWithDates(dates, dates, maxPoints).dates;

        let traces: Data[] = [];
        if (selectedPnLAsset === '') {
          // Show all assets - use shared time-series when available, fallback to current P&L.
          traces = assets.map(asset => {
            const series = pnlSeriesByAsset.get(asset);
            const values = (series?.values || new Array(chartDates.length).fill(pnlData.assetPnL[asset]?.pnl || 0)).slice(idx);
            const sampledY = sampleDataWithDates(dates, values, maxPoints).data;

            return {
              x: sampledDates,
              y: sampledY as number[],
              type: 'scatter' as const,
              mode: 'lines' as const,
              name: asset,
              line: { color: colorFor(asset) },
              hovertemplate: `${asset}: %{y:.2f} USD<extra></extra>`,
            };
          });
        } else {
          const series = pnlSeriesByAsset.get(selectedPnLAsset);
          const values = (series?.values || new Array(chartDates.length).fill(pnlData.assetPnL[selectedPnLAsset]?.pnl || 0)).slice(idx);
          const sampledY = sampleDataWithDates(dates, values, maxPoints).data;

          traces = [{
            x: sampledDates,
            y: sampledY as number[],
            type: 'scatter' as const,
            mode: 'lines' as const,
            name: selectedPnLAsset,
            line: { color: colorFor(selectedPnLAsset), width: 3 },
            hovertemplate: `${selectedPnLAsset}: %{y:.2f} USD<extra></extra>`,
          }];
        }

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
              yaxis: { title: { text: 'P&L (USD)' } },
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
