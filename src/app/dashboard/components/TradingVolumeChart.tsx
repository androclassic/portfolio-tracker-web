'use client';
import React, { useMemo } from 'react';
import { getAssetColor, isStablecoin } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import { PlotlyChart as Plot } from '@/components/charts/plotly/PlotlyChart';
import { startIsoForTimeframe } from '@/lib/timeframe';
import { useDashboardData } from '../../DashboardDataProvider';
import type { Data } from 'plotly.js';

export function TradingVolumeChart() {
  const { txs, loadingTxs } = useDashboardData();

  // Compute per-asset USD volume from all transactions
  const volumeByAsset = useMemo(() => {
    if (!txs || txs.length === 0) return new Map<string, { total: number; byDate: Map<string, number> }>();

    const result = new Map<string, { total: number; byDate: Map<string, number> }>();

    const addVolume = (asset: string, usd: number, date: string) => {
      if (!asset || usd <= 0 || isNaN(usd) || isStablecoin(asset)) return;
      let entry = result.get(asset);
      if (!entry) {
        entry = { total: 0, byDate: new Map() };
        result.set(asset, entry);
      }
      entry.total += usd;
      entry.byDate.set(date, (entry.byDate.get(date) ?? 0) + usd);
    };

    for (const tx of txs) {
      const date = tx.datetime.slice(0, 10);
      // To-side volume (deposits, withdrawals, swap destination)
      if (tx.toAsset && tx.toQuantity && tx.toPriceUsd) {
        addVolume(tx.toAsset.toUpperCase(), tx.toQuantity * tx.toPriceUsd, date);
      }
      // From-side volume (swaps source)
      if (tx.fromAsset && tx.fromQuantity && tx.fromPriceUsd) {
        addVolume(tx.fromAsset.toUpperCase(), tx.fromQuantity * tx.fromPriceUsd, date);
      }
    }

    return result;
  }, [txs]);

  return (
    <ChartCard title="Trading Volume by Asset" defaultTimeframe="all">
      {({ timeframe, expanded }) => {
        if (loadingTxs) {
          return <div className="chart-loading">Loading volume data...</div>;
        }
        if (volumeByAsset.size === 0) {
          return <div className="chart-empty">No transaction data available</div>;
        }

        // Filter by timeframe
        const startIso = startIsoForTimeframe(timeframe);
        const filtered: Array<{ asset: string; volume: number }> = [];

        for (const [asset, data] of volumeByAsset) {
          let vol = 0;
          if (!startIso) {
            // 'all' timeframe
            vol = data.total;
          } else {
            for (const [date, usd] of data.byDate) {
              if (date >= startIso) vol += usd;
            }
          }
          if (vol > 0) filtered.push({ asset, volume: vol });
        }

        if (filtered.length === 0) {
          return <div className="chart-empty">No volume for the selected timeframe</div>;
        }

        // Sort ascending so largest bar is at top in horizontal layout
        filtered.sort((a, b) => a.volume - b.volume);

        const assets = filtered.map(f => f.asset);
        const volumes = filtered.map(f => f.volume);
        const colors = filtered.map(f => getAssetColor(f.asset));

        const traces: Data[] = [
          {
            type: 'bar',
            orientation: 'h',
            x: volumes,
            y: assets,
            marker: { color: colors },
            text: volumes.map(v => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`),
            textposition: 'outside',
            hovertemplate: '%{y}: $%{x:,.0f}<extra></extra>',
          },
        ];

        return (
          <Plot
            data={traces}
            layout={{
              yaxis: { automargin: true },
              xaxis: { title: { text: 'Volume (USD)' } },
              showlegend: false,
              height: expanded ? undefined : Math.max(300, filtered.length * 32 + 80),
            }}
            style={{ width: '100%', height: expanded ? '100%' : undefined }}
          />
        );
      }}
    </ChartCard>
  );
}
