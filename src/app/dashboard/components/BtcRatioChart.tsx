'use client';
import React, { useCallback, useMemo, useState } from 'react';
import { isStablecoin } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import { PlotlyChart as Plot } from '@/components/charts/plotly/PlotlyChart';
import { sliceStartIndexForIsoDates, sampleDataWithDates } from '@/lib/timeframe';
import { useDashboardData } from '../../DashboardDataProvider';
import { getEURCPrice } from '../lib/chart-helpers';
import type { Data } from 'plotly.js';

export function BtcRatioChart() {
  const { txs, assets, historicalPrices, fxRateMap, loadingTxs, loadingCurr, loadingHist } = useDashboardData();

  const [selectedBtcChart, setSelectedBtcChart] = useState<string>('accumulation');

  const getEURCPriceFn = useCallback(
    (date?: string) => getEURCPrice(fxRateMap, date),
    [fxRateMap]
  );

  const hist = useMemo(() => ({ prices: historicalPrices }), [historicalPrices]);
  const isLoading = loadingTxs || loadingCurr || loadingHist;

  const btcRatio = useMemo(() => {
    if (!hist || !hist.prices || assets.length === 0 || !txs || txs.length === 0) {
      return { dates: [] as string[], btcValue: [] as number[], btcPercentage: [] as number[], portfolioInBtc: [] as number[] };
    }

    const priceMap = new Map<string, number>();
    for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);

    const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
    const txsByDate = new Map<string, { asset: string; type: 'Buy' | 'Sell'; qty: number }[]>();
    for (const t of txs) {
      const day = new Date(t.datetime).toISOString().slice(0, 10);
      const arr = txsByDate.get(day) || [];

      if (t.type === 'Swap') {
        if (t.toAsset) {
          const toA = t.toAsset.toUpperCase();
          if (toA !== 'USD') {
            arr.push({ asset: toA, type: 'Buy' as const, qty: Math.abs(t.toQuantity) });
          }
        }
        if (t.fromAsset) {
          const fromA = t.fromAsset.toUpperCase();
          if (fromA !== 'USD') {
            arr.push({ asset: fromA, type: 'Sell' as const, qty: Math.abs(t.fromQuantity || 0) });
          }
        }
      } else if (t.type === 'Deposit') {
        const toA = t.toAsset.toUpperCase();
        if (toA !== 'USD') {
          arr.push({ asset: toA, type: 'Buy' as const, qty: Math.abs(t.toQuantity) });
        }
      } else if (t.type === 'Withdrawal') {
        const fromA = t.fromAsset?.toUpperCase();
        if (fromA && fromA !== 'USD') {
          arr.push({ asset: fromA, type: 'Sell' as const, qty: Math.abs(t.fromQuantity || 0) });
        }
      }
      txsByDate.set(day, arr);
    }

    const currentHoldings: Record<string, number> = {};
    for (const a of assets) currentHoldings[a] = currentHoldings[a] || 0;

    const btcValue: number[] = [];
    const btcPercentage: number[] = [];
    const portfolioInBtc: number[] = [];

    for (const date of dates) {
      const todays = txsByDate.get(date) || [];
        for (const tx of todays) {
          if (tx.type === 'Buy') {
            currentHoldings[tx.asset] = (currentHoldings[tx.asset] || 0) + tx.qty;
          } else {
            currentHoldings[tx.asset] = Math.max(0, (currentHoldings[tx.asset] || 0) - tx.qty);
          }
        }

      const btcPrice = priceMap.get(date + '|BTC') || 0;
      let totalValueUsd = 0;
      let btcValueUsd = 0;

      for (const asset of assets) {
        const qty = currentHoldings[asset] || 0;
        if (qty <= 0) continue;
        let px = 0;
        if (asset === 'EURC') {
          px = getEURCPriceFn(date);
        } else if (isStablecoin(asset)) {
          px = 1;
        } else {
          px = priceMap.get(date + '|' + asset) || 0;
        }
        const val = qty * px;
        totalValueUsd += val;
        if (asset === 'BTC') btcValueUsd = val;
      }

      btcValue.push(currentHoldings['BTC'] || 0);
      btcPercentage.push(totalValueUsd > 0 ? (btcValueUsd / totalValueUsd) * 100 : 0);
      portfolioInBtc.push(btcPrice > 0 ? totalValueUsd / btcPrice : 0);
    }

    const result = { dates, btcValue, btcPercentage, portfolioInBtc };
    return result;
  }, [hist, assets, txs, getEURCPriceFn]);

  return (
    <ChartCard
      title="Bitcoin Overview"
      headerActions={() => (
        <label className="chart-control">
          Chart Type
          <select value={selectedBtcChart} onChange={e => setSelectedBtcChart(e.target.value)}>
            <option value="accumulation">Accumulation</option>
            <option value="ratio">BTC Ratio</option>
            <option value="portfolio-btc">Portfolio in BTC</option>
          </select>
        </label>
      )}
    >
      {({ timeframe, expanded }) => {
        if (isLoading) {
          return <div className="chart-loading">Loading BTC data...</div>;
        }
        if (!btcRatio.dates.length) {
          return <div className="chart-empty">No BTC data</div>;
        }
        const idx = sliceStartIndexForIsoDates(btcRatio.dates, timeframe);
        const dates = btcRatio.dates.slice(idx);

        // Sample data points for performance (max 100 points)
        const maxPoints = expanded ? 200 : 100;

        if (selectedBtcChart === 'ratio') {
          const ratioData = btcRatio.btcPercentage.slice(idx);
          const sampled = sampleDataWithDates(dates, ratioData, maxPoints);
          return (
            <Plot
              data={[
                {
                  x: sampled.dates,
                  y: sampled.data,
                  type: 'scatter',
                  mode: 'lines',
                  name: 'BTC Ratio',
                  line: { color: '#f7931a', width: 2 },
                },
              ] as Data[]}
              layout={{
                autosize: true,
                height: expanded ? undefined : 320,
                margin: { t: 30, r: 10, l: 40, b: 40 },
                yaxis: { title: { text: 'BTC Ratio (%)' } },
                hovermode: 'x unified',
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
              }}
              style={{ width: '100%', height: expanded ? '100%' : undefined }}
            />
          );
        } else if (selectedBtcChart === 'portfolio-btc') {
          const portfolioData = btcRatio.portfolioInBtc.slice(idx);
          const sampled = sampleDataWithDates(dates, portfolioData, maxPoints);
          return (
            <Plot
              data={[
                {
                  x: sampled.dates,
                  y: sampled.data,
                  type: 'scatter',
                  mode: 'lines',
                  name: 'Portfolio Value',
                  line: { color: '#f7931a', width: 2 },
                  hovertemplate: '%{y:.4f} BTC<extra></extra>',
                },
              ] as Data[]}
              layout={{
                autosize: true,
                height: expanded ? undefined : 320,
                margin: { t: 30, r: 10, l: 50, b: 40 },
                yaxis: { title: { text: 'Portfolio Value (BTC)' } },
                hovermode: 'x unified',
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
              }}
              style={{ width: '100%', height: expanded ? '100%' : undefined }}
            />
          );
        } else {
          // Accumulation chart
          const accumulationData = btcRatio.btcValue.slice(idx);
          const sampled = sampleDataWithDates(dates, accumulationData, maxPoints);
          return (
            <Plot
              data={[
                {
                  x: sampled.dates,
                  y: sampled.data,
                  type: 'scatter',
                  mode: 'lines',
                  name: 'BTC Accumulated',
                  line: { color: '#f7931a', width: 2 },
                },
              ] as Data[]}
              layout={{
                autosize: true,
                height: expanded ? undefined : 320,
                margin: { t: 30, r: 10, l: 40, b: 40 },
                yaxis: { title: { text: 'BTC Units' } },
                hovermode: 'x unified',
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
              }}
              style={{ width: '100%', height: expanded ? '100%' : undefined }}
            />
          );
        }
      }}
    </ChartCard>
  );
}
