'use client';
import React, { useCallback, useMemo } from 'react';
import { isStablecoin } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import { LineChart } from '@/components/charts/LineChart';
import { buildNetWorthLineChartModel } from '@/lib/chart-models/net-worth';
import { sliceStartIndexForIsoDates, sampleDataPoints } from '@/lib/timeframe';
import { useDashboardData } from '../../DashboardDataProvider';
import { getEURCPrice } from '../lib/chart-helpers';

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

  const netWorthChartModel = useMemo(() => {
    return buildNetWorthLineChartModel(netWorthOverTime);
  }, [netWorthOverTime]);

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
        const slicedDates = netWorthOverTime.dates.slice(startIdx);
        const slicedSeries = netWorthChartModel.series.map(s => ({
          ...s,
          y: s.y.slice(startIdx),
        }));

        if (slicedDates.length === 0 || !slicedSeries[0] || slicedSeries[0].y.length === 0) {
          return <div className="chart-empty">No data available for the selected timeframe</div>;
        }

        const minLength = Math.min(slicedDates.length, ...slicedSeries.map(s => s.y.length));
        if (minLength === 0) {
          return <div className="chart-empty">No data available for the selected timeframe</div>;
        }

        const finalDates = slicedDates.slice(0, minLength);
        const finalSeries = slicedSeries.map(s => ({
          ...s,
          y: s.y.slice(0, minLength),
        }));

        const maxPoints = expanded ? Infinity : 100;
        let chartModel;

        if (finalDates.length > maxPoints) {
          const dataArrays = finalSeries.map(s => s.y);
          const sampled = sampleDataPoints(finalDates, dataArrays, maxPoints);

          if (sampled.dates.length === 0 || sampled.dataArrays.length === 0 || sampled.dataArrays[0]!.length === 0) {
            return <div className="chart-empty">No data available for the selected timeframe</div>;
          }

          chartModel = {
            title: netWorthChartModel.title,
            xAxisTitle: netWorthChartModel.xAxisTitle,
            yAxisTitle: netWorthChartModel.yAxisTitle,
            height: netWorthChartModel.height,
            hovermode: netWorthChartModel.hovermode,
            x: [...sampled.dates],
            series: sampled.dataArrays.map((yData, i) => ({
              ...finalSeries[i]!,
              y: [...yData],
            })),
          };
        } else {
          chartModel = {
            title: netWorthChartModel.title,
            xAxisTitle: netWorthChartModel.xAxisTitle,
            yAxisTitle: netWorthChartModel.yAxisTitle,
            height: netWorthChartModel.height,
            hovermode: netWorthChartModel.hovermode,
            x: [...finalDates],
            series: finalSeries.map(s => ({
              ...s,
              y: [...s.y],
            })),
          };
        }

        if (!chartModel.x || chartModel.x.length === 0 || !chartModel.series || chartModel.series.length === 0) {
          return <div className="chart-empty">No data available for the selected timeframe</div>;
        }

        const xLength = chartModel.x.length;
        const validSeries = chartModel.series.map(s => {
          if (s.y.length !== xLength) {
            return { ...s, y: s.y.slice(0, xLength) };
          }
          return s;
        }).filter(s => s.y.length > 0);

        if (validSeries.length === 0) {
          return <div className="chart-empty">No data available for the selected timeframe</div>;
        }

        const finalModel = {
          ...chartModel,
          series: validSeries.map(s => ({ ...s, y: [...s.y] })),
          x: [...chartModel.x],
        };

        const dataKey = `${netWorthOverTime.dates.length}-${netWorthOverTime.dates[netWorthOverTime.dates.length - 1] || ''}-${netWorthOverTime.dates[0] || ''}-${finalModel.x.length}`;

        return (
          <LineChart
            key={`net-worth-${timeframe}-${expanded}-${dataKey}`}
            model={finalModel}
          />
        );
      }}
    </ChartCard>
  );
}
