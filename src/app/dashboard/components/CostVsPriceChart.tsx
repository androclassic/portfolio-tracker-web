'use client';
import React, { useMemo } from 'react';
import { ChartCard } from '@/components/ChartCard';
import { PlotlyChart as Plot } from '@/components/charts/plotly/PlotlyChart';
import { sliceStartIndexForIsoDates, sampleDataPoints } from '@/lib/timeframe';
import { useDashboardData } from '../../DashboardDataProvider';
import { useAutoSelectAsset } from '../lib/use-auto-select-asset';
import type { Data } from 'plotly.js';

export function CostVsPriceChart() {
  const { txs, assets, historicalPrices, loadingTxs } = useDashboardData();

  const [selectedCostAsset, setSelectedCostAsset] = useAutoSelectAsset(assets);

  const hist = useMemo(() => ({ prices: historicalPrices }), [historicalPrices]);

  const costVsPrice = useMemo(() => {
    if (!hist || !hist.prices || !selectedCostAsset) return { dates: [] as string[], avgCost: [] as number[], price: [] as number[] };
    const asset = selectedCostAsset.toUpperCase();
    const dates = Array.from(new Set(hist.prices.filter(p => p.asset.toUpperCase() === asset).map(p => p.date))).sort();
    const txsA = (txs || []).filter(t => {
      if (t.type === 'Swap') {
        return t.toAsset.toUpperCase() === asset || t.fromAsset?.toUpperCase() === asset;
      }
      return false;
    }).map(t => {
      const date = new Date(new Date(t.datetime).getFullYear(), new Date(t.datetime).getMonth(), new Date(t.datetime).getDate()).toISOString().slice(0, 10);
      if (t.toAsset.toUpperCase() === asset) {
        return { date, type: 'Buy' as const, units: Math.abs(t.toQuantity), unitPrice: t.toPriceUsd || 0 };
      } else {
        return { date, type: 'Sell' as const, units: Math.abs(t.fromQuantity || 0), unitPrice: t.fromPriceUsd || 0 };
      }
    });
    const txByDate = new Map<string, { type: 'Buy' | 'Sell'; units: number; unitPrice: number }[]>();
    for (const tx of txsA) { const arr = txByDate.get(tx.date) || []; arr.push(tx); txByDate.set(tx.date, arr); }
    let units = 0; let costVal = 0;
    const avgCost: number[] = [];
    const price: number[] = [];
    const priceMap = new Map<string, number>();
    for (const p of hist.prices.filter(p => p.asset.toUpperCase() === asset)) priceMap.set(p.date, p.price_usd);
    for (const d of dates) {
      const todays = txByDate.get(d) || [];
      for (const tx of todays) {
        if (tx.type === 'Buy') { units += tx.units; costVal += tx.units * tx.unitPrice; }
        else {
          const avg = units > 0 ? costVal / units : 0; const qty = Math.min(tx.units, units);
          costVal -= avg * qty; units -= qty;
        }
      }
      const avg = units > 0 ? costVal / units : 0;
      avgCost.push(Number(avg.toFixed(6)));
      price.push(priceMap.get(d) || 0);
    }
    const result = { dates, avgCost, price };
    return result;
  }, [hist, txs, selectedCostAsset]);

  return (
    <ChartCard
      title="Cost Basis vs Market Price"
      headerActions={() => (
        <label className="chart-control">
          Asset
          <select value={selectedCostAsset} onChange={e => setSelectedCostAsset(e.target.value)}>
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
          return <div className="chart-loading">Loading cost vs price...</div>;
        }
        if (!costVsPrice.dates.length) {
          return <div className="chart-empty">No cost vs price data</div>;
        }
        const idx = sliceStartIndexForIsoDates(costVsPrice.dates, timeframe);
        const dates = costVsPrice.dates.slice(idx);
        const avgCost = costVsPrice.avgCost.slice(idx);
        const price = costVsPrice.price.slice(idx);

        // Sample data points for performance (max 100 points)
        const maxPoints = expanded ? 200 : 100;
        const sampled = sampleDataPoints(dates, [avgCost, price], maxPoints);

        return (
          <Plot
            data={[
              {
                x: sampled.dates,
                y: sampled.dataArrays[0]!,
                type: 'scatter',
                mode: 'lines',
                name: 'Average Cost',
                line: { color: '#5b8cff', width: 2 },
              },
              {
                x: sampled.dates,
                y: sampled.dataArrays[1]!,
                type: 'scatter',
                mode: 'lines',
                name: 'Market Price',
                line: { color: '#16a34a', width: 2 },
              },
            ] as Data[]}
            layout={{
              autosize: true,
              height: expanded ? undefined : 320,
              margin: { t: 30, r: 10, l: 40, b: 40 },
              legend: { orientation: 'h' },
              yaxis: { title: { text: 'Price (USD)' } },
              hovermode: 'x unified',
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
