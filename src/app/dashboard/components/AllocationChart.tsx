'use client';
import React, { useCallback, useMemo } from 'react';
import { isStablecoin } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import AllocationPieChart from '@/components/AllocationPieChart';
import { useDashboardData } from '../../DashboardDataProvider';
import { getEURCPrice } from '../lib/chart-helpers';

export function AllocationChart() {
  const { holdings, latestPrices, historicalPrices, loadingTxs, loadingCurr, loadingHist, fxRateMap } = useDashboardData();
  const isLoading = loadingTxs || loadingCurr || loadingHist;

  const getEURCPriceFn = useCallback(
    (date?: string) => getEURCPrice(fxRateMap, date),
    [fxRateMap]
  );

  const hist = useMemo(() => ({ prices: historicalPrices }), [historicalPrices]);

  const allocationData = useMemo(() => {
    return Object.entries(holdings)
      .map(([asset, units]) => {
        let price = latestPrices[asset];
        if (price === undefined || price === 0) {
          if (asset === 'EURC') {
            price = getEURCPriceFn();
          } else if (isStablecoin(asset)) {
            price = 1.0;
          } else {
            const assetPrices = hist.prices.filter(p => p.asset === asset && p.price_usd != null && p.price_usd > 0);
            if (assetPrices.length > 0) {
              assetPrices.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
              price = assetPrices[0]!.price_usd || 0;
            } else {
              price = 0;
            }
          }
        }
        return { asset, units, value: price * units };
      })
      .filter(p => p.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [holdings, latestPrices, getEURCPriceFn, hist]);

  return (
    <ChartCard title="Portfolio Allocation" timeframeEnabled={false}>
      {({ timeframe, expanded }) => {
        if (isLoading) {
          return <div className="chart-loading">Loading allocation...</div>;
        }
        return (
          <AllocationPieChart
            data={allocationData}
            isLoading={isLoading}
            height={expanded ? 500 : 320}
          />
        );
      }}
    </ChartCard>
  );
}
