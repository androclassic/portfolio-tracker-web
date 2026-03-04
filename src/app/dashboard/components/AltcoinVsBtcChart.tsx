'use client';
import React, { useCallback, useMemo, useState } from 'react';
import { getAssetColor, isFiatCurrency } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import { EChart } from '@/components/charts/echarts';
import { sliceStartIndexForIsoDates, sampleDataWithDates } from '@/lib/timeframe';
import { useDashboardData } from '../../DashboardDataProvider';
import type { EChartsOption } from 'echarts';

export function AltcoinVsBtcChart() {
  const { txs, assets, dailyPos, historicalPrices, priceIndex, loadingTxs } = useDashboardData();

  const [selectedAltcoin, setSelectedAltcoin] = useState<string>('ALL');
  const colorFor = useCallback((asset: string): string => getAssetColor(asset), []);

  const altcoins = useMemo(
    () => assets.filter(a => a !== 'BTC' && !isFiatCurrency(a)),
    [assets]
  );

  const hist = useMemo(() => ({ prices: historicalPrices }), [historicalPrices]);

  const altcoinVsBtc = useMemo(() => {
    if (!hist || !hist.prices || altcoins.length === 0 || !dailyPos || dailyPos.length === 0) {
      return { dates: [] as string[], performance: {} as Record<string, number[]> };
    }

    const priceMap = new Map<string, number>();
    for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);

    const dates = priceIndex.dates.length > 0
      ? priceIndex.dates
      : Array.from(new Set(hist.prices.map(p => p.date))).sort();

    const positionsByAsset = new Map<string, Array<{ date: string; position: number }>>();
    for (const pos of dailyPos) {
      if (isFiatCurrency(pos.asset)) continue;
      if (!positionsByAsset.has(pos.asset)) {
        positionsByAsset.set(pos.asset, []);
      }
      positionsByAsset.get(pos.asset)!.push({ date: pos.date, position: pos.position });
    }

    for (const positions of positionsByAsset.values()) {
      positions.sort((a, b) => a.date.localeCompare(b.date));
    }

    const performanceData: Record<string, number[]> = {};
    const assetIndices = new Map<string, number>();

    for (const asset of altcoins) {
      const btcValues: number[] = [];
      const positions = positionsByAsset.get(asset);

      for (const date of dates) {
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
  }, [hist, altcoins, dailyPos, priceIndex]);

  return (
    <ChartCard
      title="Altcoin Holdings BTC Value"
      headerActions={() => (
        <label className="chart-control">
          Asset
          <select value={selectedAltcoin} onChange={e => setSelectedAltcoin(e.target.value)}>
            <option value="ALL">All Altcoins</option>
            {altcoins.map(a => (
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

        const maxPoints = expanded ? 200 : 100;
        const sampledDates = sampleDataWithDates(dates, dates, maxPoints).dates;

        const assetsToShow = selectedAltcoin !== 'ALL'
          ? [selectedAltcoin]
          : altcoins;

        const series: EChartsOption['series'] = assetsToShow.map(asset => {
          const yData = (altcoinVsBtc.performance[asset] || []).slice(idx);
          const sampled = sampleDataWithDates(dates, yData, maxPoints);
          return {
            type: 'line' as const, name: asset, data: sampled.data as number[], showSymbol: false,
            lineStyle: { color: colorFor(asset) }, itemStyle: { color: colorFor(asset) },
          };
        });

        const option: EChartsOption = {
          xAxis: { type: 'category', data: sampledDates },
          yAxis: { type: 'value', name: 'BTC Value of Holdings' },
          tooltip: {
            trigger: 'axis',
            formatter: (params: unknown) => {
              const ps = params as { seriesName: string; value: number; dataIndex: number; color: string }[];
              if (!Array.isArray(ps) || ps.length === 0) return '';
              const date = sampledDates[ps[0]!.dataIndex] ?? '';
              let html = `<b>${date}</b>`;
              for (const p of ps) {
                if (isNaN(p.value) || p.value <= 0) continue;
                html += `<br/><span style="color:${p.color}">\u25CF</span> ${p.seriesName}: ${p.value.toFixed(4)} BTC`;
              }
              return html;
            },
          },
          legend: { show: assetsToShow.length > 1 },
          series,
        };

        return (
          <EChart
            option={option}
            style={{ width: '100%', height: expanded ? '100%' : 320 }}
            notMerge
          />
        );
      }}
    </ChartCard>
  );
}
