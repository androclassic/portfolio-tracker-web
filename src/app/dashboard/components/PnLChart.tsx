'use client';
import React, { useCallback, useMemo } from 'react';
import { getAssetColor } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import { PlotlyChart as Plot } from '@/components/charts/plotly/PlotlyChart';
import { sliceStartIndexForIsoDates, sampleDataWithDates } from '@/lib/timeframe';
import { useDashboardData } from '../../DashboardDataProvider';
import { useAutoSelectAsset } from '../lib/use-auto-select-asset';
import { STABLECOINS } from '@/lib/types';
import type { Data } from 'plotly.js';

export function PnLChart() {
  const { txs, assets, historicalPrices, loadingTxs, pnlData } = useDashboardData();

  const [selectedPnLAsset, setSelectedPnLAsset] = useAutoSelectAsset(assets);
  const colorFor = useCallback((asset: string): string => getAssetColor(asset), []);

  const hist = useMemo(() => ({ prices: historicalPrices }), [historicalPrices]);

  const pnl = useMemo(() => {
    if (!hist || !hist.prices || assets.length === 0 || !txs || txs.length === 0 || !selectedPnLAsset) {
      return { dates: [] as string[], realized: [] as number[], unrealized: [] as number[] };
    }
    const priceMap = new Map<string, number>();
    for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);

    const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
    const filteredTxs = txs
      .filter(t => {
        if (t.type === 'Swap') {
          return t.toAsset.toUpperCase() === selectedPnLAsset || t.fromAsset?.toUpperCase() === selectedPnLAsset;
        }
        return false;
      })
      .filter(t => {
        return ![...STABLECOINS, 'USD'].includes(selectedPnLAsset);
      });

    type TxEnriched = { asset: string; type: 'Buy' | 'Sell'; units: number; unitPrice: number };
      const txByDate = new Map<string, TxEnriched[]>();
    for (const t of filteredTxs) {
      if (t.type !== 'Swap') continue;
        const day = new Date(new Date(t.datetime).getFullYear(), new Date(t.datetime).getMonth(), new Date(t.datetime).getDate()).toISOString().slice(0, 10);
        const key = day;
        const arr = txByDate.get(key) || [];

      if (t.toAsset.toUpperCase() === selectedPnLAsset) {
        const asset = t.toAsset.toUpperCase();
        const units = Math.abs(t.toQuantity);
        const unitPrice = t.toPriceUsd || priceMap.get(day + '|' + asset) || 0;
        arr.push({ asset, type: 'Buy' as const, units, unitPrice });
      } else if (t.fromAsset?.toUpperCase() === selectedPnLAsset) {
        const asset = t.fromAsset.toUpperCase();
        const units = Math.abs(t.fromQuantity || 0);
        const unitPrice = t.fromPriceUsd || priceMap.get(day + '|' + asset) || 0;
        arr.push({ asset, type: 'Sell' as const, units, unitPrice });
      }

        txByDate.set(key, arr);
      }

      const heldUnits = new Map<string, number>();
      const heldCost = new Map<string, number>();
      let realizedCum = 0;
      const realizedSeries: number[] = [];
      const unrealizedSeries: number[] = [];

      for (const d of dates) {
        const todays = txByDate.get(d) || [];
        for (const tx of todays) {
          if (tx.type === 'Buy') {
          heldUnits.set(tx.asset, (heldUnits.get(tx.asset) || 0) + tx.units);
          heldCost.set(tx.asset, (heldCost.get(tx.asset) || 0) + tx.units * tx.unitPrice);
          } else {
          const units = heldUnits.get(tx.asset) || 0;
          const cost = heldCost.get(tx.asset) || 0;
          const avgCost = units > 0 ? cost / units : 0;
          const qty = Math.min(tx.units, units);
          const salePrice = tx.unitPrice;
          const profit = (salePrice - avgCost) * qty;
          realizedCum += profit;
          heldUnits.set(tx.asset, units - qty);
          heldCost.set(tx.asset, cost - avgCost * qty);
        }
      }

      const currentPrice = priceMap.get(d + '|' + selectedPnLAsset) || 0;
      let unrealized = 0;
      for (const [asset, units] of heldUnits.entries()) {
        if (units > 0 && asset === selectedPnLAsset) {
          const cost = heldCost.get(asset) || 0;
          const avgCost = units > 0 ? cost / units : 0;
          unrealized += (currentPrice - avgCost) * units;
        }
      }

      realizedSeries.push(realizedCum);
      unrealizedSeries.push(unrealized);
    }

    const result = { dates, realized: realizedSeries, unrealized: unrealizedSeries };
    return result;
  }, [hist, txs, selectedPnLAsset, assets]);

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
        if (!pnl.dates.length) {
          return <div className="chart-empty">No P&L data</div>;
        }

        const idx = sliceStartIndexForIsoDates(pnl.dates, timeframe);
        const dates = pnl.dates.slice(idx);

        // Sample data points for performance (max 100 points per trace)
        const maxPoints = expanded ? 200 : 100;
        const sampledDates = sampleDataWithDates(dates, dates, maxPoints).dates;

        let traces: Data[] = [];
        if (selectedPnLAsset === '') {
          // Show all assets - use current P&L values
          traces = assets.map(asset => {
            const currentPnl = pnlData.assetPnL[asset]?.pnl || 0;
            const pnlValues = new Array(dates.length).fill(currentPnl);
            const sampledY = sampleDataWithDates(dates, pnlValues.slice(idx), maxPoints).data;

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
          // Show selected asset - use time series P&L if available, otherwise current P&L
          if (pnl.dates.length > 0 && selectedPnLAsset) {
            // Use time series data
            const sampledY = sampleDataWithDates(dates, pnl.realized.slice(idx), maxPoints).data;
            traces = [{
              x: sampledDates,
              y: sampledY as number[],
              type: 'scatter' as const,
              mode: 'lines' as const,
              name: selectedPnLAsset,
              line: { color: colorFor(selectedPnLAsset), width: 3 },
              hovertemplate: `${selectedPnLAsset}: %{y:.2f} USD<extra></extra>`,
            }];
          } else {
            // Use current P&L value
            const currentPnl = pnlData.assetPnL[selectedPnLAsset]?.pnl || 0;
            const pnlValues = new Array(dates.length).fill(currentPnl);
            const sampledY = sampleDataWithDates(dates, pnlValues.slice(idx), maxPoints).data;

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
        }

        return (
          <Plot
            data={traces as Data[]}
            layout={{
              autosize: true,
              height: expanded ? undefined : 400,
              margin: { t: 30, r: 10, l: 10, b: 10 },
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
