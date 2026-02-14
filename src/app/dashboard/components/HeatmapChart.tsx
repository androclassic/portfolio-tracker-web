'use client';
import React, { useMemo, useState } from 'react';
import { isStablecoin } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import { PlotlyChart as Plot } from '@/components/charts/plotly/PlotlyChart';
import { ShortTimeframeSelector, type ShortTimeframe } from '@/components/ShortTimeframeSelector';
import { useDashboardData } from '../../DashboardDataProvider';
import type { Data } from 'plotly.js';

export function HeatmapChart() {
  const { txs, assets, historicalPrices, latestPrices, loadingTxs, loadingCurr, loadingHist } = useDashboardData();
  const isLoading = loadingTxs || loadingCurr || loadingHist;
  const [heatmapTimeframe, setHeatmapTimeframe] = useState<ShortTimeframe>('24h');

  const hist = useMemo(() => ({ prices: historicalPrices }), [historicalPrices]);

  const portfolioHeatmap = useMemo(() => {
    if (!txs || txs.length === 0 || !assets.length) {
      return { assets: [] as string[], pnlValues: [] as number[], colors: [] as string[] };
    }

    const grouped: Record<string, typeof txs> = {};
    for (const t of txs) {
      const assetList: string[] = [];
      if (t.fromAsset) assetList.push(t.fromAsset.toUpperCase());
      if (t.toAsset) assetList.push(t.toAsset.toUpperCase());
      for (const a of assetList) {
        (grouped[a] ||= []).push(t);
      }
    }

    const heatmapData: { asset: string; pnl: number; color: string }[] = [];

    let referencePriceMap: Map<string, number> | null = null;
    if (hist && hist.prices && hist.prices.length > 0) {
      const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
      const n = dates.length;
      if (n >= 2) {
        let targetDateIndex = n - 2;
        if (heatmapTimeframe === '24h') {
          targetDateIndex = n - 2;
        } else if (heatmapTimeframe === '7d' || heatmapTimeframe === '30d') {
          const daysBack = heatmapTimeframe === '7d' ? 7 : 30;
          const targetDate = new Date();
          targetDate.setDate(targetDate.getDate() - daysBack);
          const targetDateStr = targetDate.toISOString().slice(0, 10);
          for (let i = dates.length - 1; i >= 0; i--) {
            if (dates[i]! <= targetDateStr) {
              targetDateIndex = i;
              break;
            }
          }
        }
        const referenceDate = dates[targetDateIndex];
        referencePriceMap = new Map<string, number>();
        for (const p of hist.prices) {
          if (p.date === referenceDate) {
            referencePriceMap.set(p.asset.toUpperCase(), p.price_usd);
          }
        }
      }
    }

    for (const asset of assets) {
      if (isStablecoin(asset)) continue;

      const arr = grouped[asset] || [];
      let totalQuantity = 0;
      let totalCostUsd = 0;
      for (const tx of arr) {
        if (tx.type === 'Swap') {
          if (tx.toAsset.toUpperCase() === asset) {
            const quantity = Math.abs(tx.toQuantity);
            totalQuantity += quantity;
            totalCostUsd += quantity * (tx.toPriceUsd || 0);
          } else if (tx.fromAsset?.toUpperCase() === asset) {
            const quantity = Math.abs(tx.fromQuantity || 0);
            if (totalQuantity > 0) {
              const currentAvgCost = totalCostUsd / totalQuantity;
              const unitsToSell = Math.min(quantity, totalQuantity);
              totalCostUsd -= unitsToSell * currentAvgCost;
              totalQuantity -= unitsToSell;
            }
          }
        }
      }

      if (totalQuantity <= 0) continue;

      const currentPrice = latestPrices[asset] || 0;
      const referencePrice = referencePriceMap?.get(asset) ?? currentPrice;
      const currentValueUsd = totalQuantity * currentPrice;
      const referenceValueUsd = totalQuantity * referencePrice;
      const pnl = currentValueUsd - referenceValueUsd;

      const color = pnl >= 0 ? '#16a34a' : '#dc2626';
      heatmapData.push({ asset, pnl, color });
    }

    heatmapData.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));

    return {
      assets: heatmapData.map(d => d.asset),
      pnlValues: heatmapData.map(d => d.pnl),
      colors: heatmapData.map(d => d.color),
    };
  }, [txs, assets, hist, latestPrices, heatmapTimeframe]);

  return (
    <ChartCard
      title="Portfolio Gains/Losses Heatmap"
      timeframeEnabled={false}
      headerActions={({ expanded }) => (
        <ShortTimeframeSelector value={heatmapTimeframe} onChange={setHeatmapTimeframe} />
      )}
    >
      {({ timeframe, expanded }) => {
        if (isLoading) {
          return <div className="chart-loading">Loading heatmap data...</div>;
        }
        if (!portfolioHeatmap.pnlValues.length) {
          return <div className="chart-empty">No heatmap data available</div>;
        }
        const treemapData = [{
          type: 'treemap' as const,
          labels: portfolioHeatmap.assets,
          values: portfolioHeatmap.pnlValues.map(Math.abs),
          parents: portfolioHeatmap.assets.map(() => ''),
          marker: {
            colors: portfolioHeatmap.colors,
            line: { width: 1, color: 'white' }
          },
          textinfo: 'label+value',
          texttemplate: '%{label}<br>%{value:.2f}',
          hovertemplate: '%{label}: %{customdata:.2f} USD<extra></extra>',
          customdata: portfolioHeatmap.pnlValues,
        }];

        return (
          <Plot
            data={treemapData as Data[]}
            layout={{
              height: expanded ? undefined : 400,
              margin: { t: 30, r: 10, l: 10, b: 10 },
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
