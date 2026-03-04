'use client';
import React, { useCallback, useMemo, useState } from 'react';
import { isStablecoin } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import { EChart } from '@/components/charts/echarts';
import { sliceStartIndexForIsoDates, sampleDataWithDates } from '@/lib/timeframe';
import { useDashboardData } from '../../DashboardDataProvider';
import { getEURCPrice } from '../lib/chart-helpers';
import type { EChartsOption } from 'echarts';

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

        const maxPoints = expanded ? 200 : 100;

        if (selectedBtcChart === 'accumulation') {
          // 3-line chart: Total Portfolio BTC, Altcoin BTC Value, BTC Held
          const btcHeld = btcRatio.btcValue.slice(idx);
          const totalBtc = btcRatio.portfolioInBtc.slice(idx);
          const altBtc = totalBtc.map((t, i) => Math.max(0, t - (btcHeld[i] ?? 0)));

          const sampledDates = sampleDataWithDates(dates, dates, maxPoints).dates;
          const sampledTotal = sampleDataWithDates(dates, totalBtc, maxPoints).data as number[];
          const sampledAlt = sampleDataWithDates(dates, altBtc, maxPoints).data as number[];
          const sampledHeld = sampleDataWithDates(dates, btcHeld, maxPoints).data as number[];

          const option: EChartsOption = {
            xAxis: { type: 'category', data: sampledDates },
            yAxis: { type: 'value', name: 'BTC Amount' },
            tooltip: {
              trigger: 'axis',
              formatter: (params: unknown) => {
                const ps = params as { seriesName: string; value: number; dataIndex: number; color: string }[];
                if (!Array.isArray(ps) || ps.length === 0) return '';
                const date = sampledDates[ps[0]!.dataIndex] ?? '';
                let html = `<b>${date}</b>`;
                for (const p of ps) {
                  html += `<br/><span style="color:${p.color}">\u25CF</span> ${p.seriesName}: ${p.value.toFixed(4)} BTC`;
                }
                return html;
              },
            },
            legend: { show: true },
            series: [
              {
                type: 'line', name: 'Total Portfolio BTC', data: sampledTotal, showSymbol: false,
                lineStyle: { color: '#5b8cff', width: 2 }, itemStyle: { color: '#5b8cff' },
              },
              {
                type: 'line', name: 'Altcoin BTC Value', data: sampledAlt, showSymbol: false,
                lineStyle: { color: '#16a34a', width: 1.5 }, itemStyle: { color: '#16a34a' },
                areaStyle: { color: 'rgba(22, 163, 74, 0.15)' },
              },
              {
                type: 'line', name: 'BTC Held', data: sampledHeld, showSymbol: false,
                lineStyle: { color: '#f7931a', width: 1.5 }, itemStyle: { color: '#f7931a' },
                areaStyle: { color: 'rgba(247, 147, 26, 0.15)' },
              },
            ],
          };

          return (
            <EChart
              option={option}
              style={{ width: '100%', height: expanded ? '100%' : 320 }}
            />
          );
        }

        // Single-line modes: ratio and portfolio-btc
        let yData: number[];
        let yAxisName: string;
        let seriesName: string;
        let tooltipFmt: ((p: { value: number }[]) => string) | undefined;

        if (selectedBtcChart === 'ratio') {
          yData = btcRatio.btcPercentage.slice(idx);
          yAxisName = 'BTC Ratio (%)';
          seriesName = 'BTC Ratio';
        } else {
          yData = btcRatio.portfolioInBtc.slice(idx);
          yAxisName = 'Portfolio Value (BTC)';
          seriesName = 'Portfolio Value';
          tooltipFmt = (params) => params.map(p => `${p.value.toFixed(4)} BTC`).join('<br/>');
        }

        const sampled = sampleDataWithDates(dates, yData, maxPoints);

        const option: EChartsOption = {
          xAxis: { type: 'category', data: sampled.dates },
          yAxis: { type: 'value', name: yAxisName },
          tooltip: {
            trigger: 'axis',
            formatter: tooltipFmt as never,
          },
          series: [
            {
              type: 'line', name: seriesName, data: sampled.data as number[], showSymbol: false,
              lineStyle: { color: '#f7931a', width: 2 }, itemStyle: { color: '#f7931a' },
            },
          ],
        };

        return (
          <EChart
            option={option}
            style={{ width: '100%', height: expanded ? '100%' : 320 }}
          />
        );
      }}
    </ChartCard>
  );
}
