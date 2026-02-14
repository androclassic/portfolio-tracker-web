'use client';
import React, { useCallback, useMemo, useState } from 'react';
import { getAssetColor } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import { PlotlyChart as Plot } from '@/components/charts/plotly/PlotlyChart';
import { sliceStartIndexForIsoDates, sampleDataWithDates } from '@/lib/timeframe';
import { useDashboardData } from '../../DashboardDataProvider';
import type { Data } from 'plotly.js';

export function AltcoinVsBtcChart() {
  const { txs, assets, dailyPos, historicalPrices, priceIndex, loadingTxs } = useDashboardData();

  const [selectedAltcoin, setSelectedAltcoin] = useState<string>('ALL');
  const colorFor = useCallback((asset: string): string => getAssetColor(asset), []);

  const hist = useMemo(() => ({ prices: historicalPrices }), [historicalPrices]);

  // Altcoin Holdings BTC Value - Use dailyPos instead of filtering transactions
  const altcoinVsBtc = useMemo(() => {
    if (!hist || !hist.prices || assets.length === 0 || !dailyPos || dailyPos.length === 0) {
      return { dates: [] as string[], performance: {} as Record<string, number[]> };
    }

    const priceMap = new Map<string, number>();
    for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);

    // Use priceIndex.dates if available, otherwise derive from historicalPrices
    const dates = priceIndex.dates.length > 0
      ? priceIndex.dates
      : Array.from(new Set(hist.prices.map(p => p.date))).sort();

    // Build position map from dailyPos with forward-fill
    const positionsByAsset = new Map<string, Array<{ date: string; position: number }>>();
    for (const pos of dailyPos) {
      if (!positionsByAsset.has(pos.asset)) {
        positionsByAsset.set(pos.asset, []);
      }
      positionsByAsset.get(pos.asset)!.push({ date: pos.date, position: pos.position });
    }

    // Sort positions by date for each asset
    for (const positions of positionsByAsset.values()) {
      positions.sort((a, b) => a.date.localeCompare(b.date));
    }

    const performanceData: Record<string, number[]> = {};
    const assetIndices = new Map<string, number>();

    for (const asset of assets) {
      if (asset === 'BTC') continue;
      const btcValues: number[] = [];
      const positions = positionsByAsset.get(asset);

      for (const date of dates) {
        // Get position: find most recent position <= current date
        let position = 0;
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

        const assetPrice = priceMap.get(date + '|' + asset) || 0;
        const btcPrice = priceMap.get(date + '|BTC') || 0;
        const valueUsd = position * assetPrice;
        const btcValue = btcPrice > 0 ? valueUsd / btcPrice : 0;
        btcValues.push(btcValue);
      }

      performanceData[asset] = btcValues;
    }

    const result = { dates, performance: performanceData };
    return result;
  }, [hist, assets, dailyPos, priceIndex]);

  return (
    <ChartCard
      title="Altcoin Holdings BTC Value"
      headerActions={() => (
        <label className="chart-control">
          Asset
          <select value={selectedAltcoin} onChange={e => setSelectedAltcoin(e.target.value)}>
            <option value="ALL">All Altcoins</option>
            {assets.filter(a => a !== 'BTC').map(a => (
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
          return <div className="chart-loading">Loading altcoin data...</div>;
        }
        if (!altcoinVsBtc.dates.length) {
          return <div className="chart-empty">No altcoin data</div>;
        }
        const idx = sliceStartIndexForIsoDates(altcoinVsBtc.dates, timeframe);
        const dates = altcoinVsBtc.dates.slice(idx);

        // Sample data points for performance (max 100 points)
        const maxPoints = expanded ? 200 : 100;
        const buildTrace = (asset: string) => {
          const yData = (altcoinVsBtc.performance[asset] || []).slice(idx);
          const sampled = sampleDataWithDates(dates, yData, maxPoints);
          return {
            x: sampled.dates,
            y: sampled.data,
            type: 'scatter' as const,
            mode: 'lines' as const,
            name: asset,
            line: { color: colorFor(asset) },
          };
        };
        const traces =
          selectedAltcoin === 'ALL'
            ? assets.filter(a => a !== 'BTC').map(buildTrace)
            : [buildTrace(selectedAltcoin)];
        return (
          <Plot
            data={traces as unknown as Data[]}
            layout={{
              autosize: true,
              height: expanded ? undefined : 320,
              margin: { t: 30, r: 10, l: 40, b: 40 },
              legend: { orientation: 'h' },
              yaxis: { title: { text: 'BTC Value of Holdings' } },
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
