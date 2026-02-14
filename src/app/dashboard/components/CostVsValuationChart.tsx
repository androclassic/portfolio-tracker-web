'use client';
import React, { useCallback, useMemo } from 'react';
import { isStablecoin } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import { PlotlyChart as Plot } from '@/components/charts/plotly/PlotlyChart';
import { sliceStartIndexForIsoDates, sampleDataPoints } from '@/lib/timeframe';
import { useDashboardData } from '../../DashboardDataProvider';
import { getEURCPrice } from '../lib/chart-helpers';
import type { Data } from 'plotly.js';

export function CostVsValuationChart() {
  const { txs, assets, dailyPos, priceIndex, fxRateMap, latestPrices, historicalPrices, loadingTxs } = useDashboardData();

  const getEURCPriceFn = useCallback(
    (date?: string) => getEURCPrice(fxRateMap, date),
    [fxRateMap]
  );

  const hist = useMemo(() => ({ prices: historicalPrices }), [historicalPrices]);

  const costVsValuation = useMemo(() => {
    if (!txs || txs.length === 0 || assets.length === 0 || !dailyPos || dailyPos.length === 0) {
      return { dates: [] as string[], costBasis: [] as number[], portfolioValue: [] as number[] };
    }
    const availablePrices = hist?.prices || [];
    if (availablePrices.length === 0) {
      return { dates: [] as string[], costBasis: [] as number[], portfolioValue: [] as number[] };
    }

    const dates = priceIndex.dates.length > 0
      ? priceIndex.dates
      : Array.from(new Set(availablePrices.map(p => p.date))).sort();
    const costBasis: number[] = [];
    const portfolioValue: number[] = [];

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

    const txsByDate = new Map<string, typeof txs>();
    for (const tx of txs) {
      const txDate = new Date(tx.datetime).toISOString().slice(0, 10);
      const arr = txsByDate.get(txDate) || [];
      arr.push(tx);
      txsByDate.set(txDate, arr);
    }

    let cumulativeCost = 0;
    const processedTxIds = new Set<number>();
    const assetIndices = new Map<string, number>();

    for (const date of dates) {
      const txsForDate = txsByDate.get(date) || [];

      for (const tx of txsForDate) {
        if (processedTxIds.has(tx.id)) continue;
        processedTxIds.add(tx.id);

        if (tx.type === 'Deposit') {
          let depositValueUsd = 0;
          if (tx.toPriceUsd) {
            depositValueUsd = tx.toQuantity * tx.toPriceUsd;
          } else {
            const fxRate = fxRateMap.get(date);
            if (fxRate && tx.toAsset) {
              const fromCurrency = tx.toAsset.toUpperCase();
              const rate = fxRate[fromCurrency] || 1;
              depositValueUsd = tx.toQuantity * rate;
            } else {
              depositValueUsd = tx.toQuantity * (latestPrices[tx.toAsset] || (isStablecoin(tx.toAsset) ? 1 : 0));
            }
          }
          cumulativeCost += depositValueUsd;
        } else if (tx.type === 'Withdrawal') {
          let withdrawalValueUsd = 0;
          if (tx.fromQuantity && tx.fromPriceUsd) {
            withdrawalValueUsd = tx.fromQuantity * tx.fromPriceUsd;
          } else if (tx.toQuantity && tx.toPriceUsd) {
            withdrawalValueUsd = tx.toQuantity * tx.toPriceUsd;
          } else {
            const fxRate = fxRateMap.get(date);
            if (fxRate && tx.fromAsset) {
              const fromCurrency = tx.fromAsset.toUpperCase();
              const rate = fxRate[fromCurrency] || 1;
              withdrawalValueUsd = (tx.fromQuantity || tx.toQuantity || 0) * rate;
            } else {
              const asset = tx.fromAsset || tx.toAsset || '';
              withdrawalValueUsd = (tx.fromQuantity || tx.toQuantity || 0) * (latestPrices[asset] || (isStablecoin(asset) ? 1 : 0));
            }
          }
          cumulativeCost -= withdrawalValueUsd;
        }
      }

      let portfolioVal = 0;
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

        let px = 0;
        if (asset === 'EURC') {
          px = getEURCPriceFn(date);
        } else if (isStablecoin(asset)) {
          px = 1.0;
        } else {
          const ai = priceIndex.assetIndex[asset];
          const di = priceIndex.dateIndex[date];
          if (ai !== undefined && di !== undefined && priceIndex.prices[ai] && priceIndex.prices[ai][di] !== undefined) {
            px = priceIndex.prices[ai][di];
          } else {
            const assetPrices = hist.prices.filter(p => p.asset === asset && p.date <= date && p.price_usd != null && p.price_usd > 0);
            if (assetPrices.length > 0) {
              assetPrices.sort((a, b) => b.date.localeCompare(a.date));
              px = assetPrices[0]!.price_usd || 0;
            } else if (latestPrices[asset]) {
              px = latestPrices[asset];
            } else {
              px = 0;
            }
          }
        }

        if (px === undefined || px === null || isNaN(px)) {
          px = 0;
        }
        if (px > 0 && position > 0) {
          portfolioVal += position * px;
        }
      }

      costBasis.push(cumulativeCost);
      portfolioValue.push(portfolioVal);
    }

    return { dates, costBasis, portfolioValue };
  }, [hist, txs, assets, priceIndex, fxRateMap, latestPrices, getEURCPriceFn, dailyPos]);

  return (
    <ChartCard title="Cost Basis vs Portfolio Valuation">
      {({ timeframe, expanded }) => {
        if (loadingTxs || !txs) {
          return <div className="chart-loading">Loading cost vs valuation data...</div>;
        }
        if (!costVsValuation.dates.length) {
          return <div className="chart-empty">No cost vs valuation data</div>;
        }
        const idx = sliceStartIndexForIsoDates(costVsValuation.dates, timeframe);
        const dates = costVsValuation.dates.slice(idx);
        const costBasisSlice = costVsValuation.costBasis.slice(idx);
        const portfolioValueSlice = costVsValuation.portfolioValue.slice(idx);

        const maxPoints = expanded ? 200 : 100;
        const sampled = sampleDataPoints(dates, [costBasisSlice, portfolioValueSlice], maxPoints);

        return (
          <Plot
            data={[
              {
                x: sampled.dates,
                y: sampled.dataArrays[0]!,
                type: 'scatter',
                mode: 'lines',
                name: 'Cost Basis',
                line: { color: '#5b8cff', width: 2 },
              },
              {
                x: sampled.dates,
                y: sampled.dataArrays[1]!,
                type: 'scatter',
                mode: 'lines',
                name: 'Portfolio Value',
                line: { color: '#16a34a', width: 2 },
              },
            ] as Data[]}
            layout={{
              autosize: true,
              height: expanded ? undefined : 400,
              margin: { t: 30, r: 10, l: 10, b: 10 },
              legend: { orientation: 'h' },
              yaxis: { title: { text: 'USD Value' } },
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
