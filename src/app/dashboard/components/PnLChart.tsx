'use client';
import React, { useCallback, useMemo } from 'react';
import { getAssetColor } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import { EChart } from '@/components/charts/echarts';
import { sliceStartIndexForIsoDates, sampleDataWithDates } from '@/lib/timeframe';
import { useDashboardData } from '../../DashboardDataProvider';
import { useAutoSelectAsset } from '../lib/use-auto-select-asset';
import { buildAssetSwapPnlSeries } from '@/lib/portfolio-engine';
import type { EChartsOption } from 'echarts';

export function PnLChart() {
  const { txs, assets, historicalPrices, loadingTxs, pnlData } = useDashboardData();

  const [selectedPnLAsset, setSelectedPnLAsset] = useAutoSelectAsset(assets);
  const colorFor = useCallback((asset: string): string => getAssetColor(asset), []);

  const pnlSeriesByAsset = useMemo(() => {
    const result = new Map<string, { dates: string[]; values: number[] }>();
    if (!txs || txs.length === 0 || assets.length === 0 || historicalPrices.length === 0) {
      return result;
    }

    for (const asset of assets) {
      const series = buildAssetSwapPnlSeries(txs, historicalPrices, asset);
      if (!series.dates.length) continue;
      result.set(asset, {
        dates: series.dates,
        values: series.realized.map((realized, i) => realized + (series.unrealized[i] || 0)),
      });
    }
    return result;
  }, [assets, historicalPrices, txs]);

  const chartDates = useMemo(() => {
    const first = pnlSeriesByAsset.values().next().value as { dates: string[] } | undefined;
    if (first?.dates?.length) return first.dates;
    return Array.from(new Set(historicalPrices.map(p => p.date))).sort();
  }, [historicalPrices, pnlSeriesByAsset]);

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
        if (!chartDates.length) {
          return <div className="chart-empty">No P&L data</div>;
        }

        const idx = sliceStartIndexForIsoDates(chartDates, timeframe);
        const dates = chartDates.slice(idx);

        const maxPoints = expanded ? 200 : 100;
        const sampledDates = sampleDataWithDates(dates, dates, maxPoints).dates;

        const series: EChartsOption['series'] = [];
        if (selectedPnLAsset === '') {
          for (const asset of assets) {
            const s = pnlSeriesByAsset.get(asset);
            const values = (s?.values || new Array(chartDates.length).fill(pnlData.assetPnL[asset]?.pnl || 0)).slice(idx);
            const sampledY = sampleDataWithDates(dates, values, maxPoints).data;
            series.push({
              type: 'line', name: asset, data: sampledY as number[], showSymbol: false,
              lineStyle: { color: colorFor(asset) }, itemStyle: { color: colorFor(asset) },
            });
          }
        } else {
          const s = pnlSeriesByAsset.get(selectedPnLAsset);
          const values = (s?.values || new Array(chartDates.length).fill(pnlData.assetPnL[selectedPnLAsset]?.pnl || 0)).slice(idx);
          const sampledY = sampleDataWithDates(dates, values, maxPoints).data;
          series.push({
            type: 'line', name: selectedPnLAsset, data: sampledY as number[], showSymbol: false,
            lineStyle: { color: colorFor(selectedPnLAsset), width: 3 }, itemStyle: { color: colorFor(selectedPnLAsset) },
          });
        }

        const option: EChartsOption = {
          xAxis: { type: 'category', data: sampledDates },
          yAxis: { type: 'value', name: 'P&L (USD)' },
          tooltip: { trigger: 'axis' },
          legend: { show: true },
          series,
        };

        return (
          <EChart
            option={option}
            style={{ width: '100%', height: expanded ? '100%' : 400 }}
          />
        );
      }}
    </ChartCard>
  );
}
