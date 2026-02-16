'use client';
import React, { useCallback, useMemo } from 'react';
import { isStablecoin } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import { PlotlyChart as Plot } from '@/components/charts/plotly/PlotlyChart';
import { sliceStartIndexForIsoDates, sampleDataPoints } from '@/lib/timeframe';
import { useDashboardData } from '../../DashboardDataProvider';
import { getEURCPrice } from '../lib/chart-helpers';
import type { Data } from 'plotly.js';

export function NetWorthChart() {
  const { assets, dailyPos, priceIndex, fxRateMap, latestPrices, historicalPrices, loadingTxs, loadingCurr, loadingHist } = useDashboardData();
  const isLoading = loadingTxs || loadingCurr || loadingHist;

  const getEURCPriceFn = useCallback(
    (date?: string) => getEURCPrice(fxRateMap, date),
    [fxRateMap]
  );

  const hist = useMemo(() => ({ prices: historicalPrices }), [historicalPrices]);

  const netWorthOverTime = useMemo(() => {
    if (!hist || !hist.prices || assets.length === 0 || !dailyPos || dailyPos.length === 0) {
      return { dates: [] as string[], cryptoExStableValue: [] as number[], stableValue: [] as number[], totalValue: [] as number[] };
    }

    const dates = priceIndex.dates.length > 0
      ? priceIndex.dates
      : Array.from(new Set(hist.prices.map(p => p.date))).sort();

    const positionsByAsset = new Map<string, Array<{ date: string; position: number }>>();
    for (const pos of dailyPos) {
      if (!positionsByAsset.has(pos.asset)) {
        positionsByAsset.set(pos.asset, []);
      }
      positionsByAsset.get(pos.asset)!.push({ date: pos.date, position: pos.position });
    }
    for (const positions of positionsByAsset.values()) {
      positions.sort((a, b) => a.date.localeCompare(b.date));
    }

    const cryptoExStableValues: number[] = [];
    const stableValues: number[] = [];
    const totalValues: number[] = [];
    const assetIndices = new Map<string, number>();

    for (const date of dates) {
      let cryptoExStable = 0;
      let stableValue = 0;

      for (const asset of assets) {
        let position = 0;
        const positions = positionsByAsset.get(asset);
        if (positions && positions.length > 0) {
          let idx = assetIndices.get(asset) ?? 0;
          while (idx < positions.length - 1 && positions[idx + 1]!.date <= date) {
            idx++;
          }
          if (positions[idx]!.date <= date) {
            position = positions[idx]!.position;
            assetIndices.set(asset, idx);
          }
        }

        let price = 0;
        if (asset === 'EURC') {
          price = getEURCPriceFn(date);
        } else if (isStablecoin(asset)) {
          price = 1.0;
        } else {
          const ai = priceIndex.assetIndex[asset];
          const di = priceIndex.dateIndex[date];
          if (ai !== undefined && di !== undefined && priceIndex.prices[ai] && priceIndex.prices[ai][di] !== undefined) {
            price = priceIndex.prices[ai][di];
          } else {
            const assetPrices = hist.prices.filter(p => p.asset === asset && p.date <= date && p.price_usd != null && p.price_usd > 0);
            if (assetPrices.length > 0) {
              assetPrices.sort((a, b) => b.date.localeCompare(a.date));
              price = assetPrices[0]!.price_usd || 0;
            } else if (latestPrices[asset]) {
              price = latestPrices[asset];
            } else {
              price = 0;
            }
          }
        }

        if (price === undefined || price === null || isNaN(price)) {
          price = 0;
        }

        const value = position * price;
        if (isStablecoin(asset)) stableValue += value;
        else cryptoExStable += value;
      }

      const totalValue = cryptoExStable + stableValue;
      cryptoExStableValues.push(cryptoExStable);
      stableValues.push(stableValue);
      totalValues.push(totalValue);
    }

    return { dates, cryptoExStableValue: cryptoExStableValues, stableValue: stableValues, totalValue: totalValues };
  }, [hist, assets, dailyPos, priceIndex, getEURCPriceFn, latestPrices]);

  return (
    <ChartCard title="Net Worth Over Time" defaultTimeframe="1y">
      {({ timeframe, expanded }) => {
        if (isLoading) {
          return <div className="chart-loading">Loading net worth data...</div>;
        }
        if (!netWorthOverTime.dates.length) {
          return <div className="chart-empty">No net worth data available</div>;
        }

        const idx = sliceStartIndexForIsoDates(netWorthOverTime.dates, timeframe);
        const startIdx = timeframe === 'all' ? 0 : Math.max(0, Math.min(idx, netWorthOverTime.dates.length));
        let dates = netWorthOverTime.dates.slice(startIdx);
        let totalY = netWorthOverTime.totalValue.slice(startIdx);
        let cryptoY = netWorthOverTime.cryptoExStableValue.slice(startIdx);
        let stableY = netWorthOverTime.stableValue.slice(startIdx);

        if (dates.length === 0) {
          return <div className="chart-empty">No data available for the selected timeframe</div>;
        }

        const maxPoints = expanded ? Infinity : 100;
        if (dates.length > maxPoints) {
          const sampled = sampleDataPoints(dates, [totalY, cryptoY, stableY], maxPoints);
          dates = sampled.dates;
          totalY = sampled.dataArrays[0]!;
          cryptoY = sampled.dataArrays[1]!;
          stableY = sampled.dataArrays[2]!;
        }

        const traces: Data[] = [
          {
            type: 'scatter',
            mode: 'lines',
            name: 'Total Net Worth',
            x: dates,
            y: totalY,
            line: { color: '#3b82f6', width: 3 },
          },
          {
            type: 'scatter',
            mode: 'lines',
            name: 'Crypto (ex Stablecoins)',
            x: dates,
            y: cryptoY,
            line: { color: '#f59e0b', width: 2 },
          },
          {
            type: 'scatter',
            mode: 'lines',
            name: 'Stablecoin Balance',
            x: dates,
            y: stableY,
            line: { color: '#22c55e', width: 2 },
          },
        ];

        return (
          <Plot
            data={traces}
            layout={{
              xaxis: { title: { text: 'Date' } },
              yaxis: { title: { text: 'Value (USD)' } },
              hovermode: 'x unified' as const,
              showlegend: true,
            }}
          />
        );
      }}
    </ChartCard>
  );
}
