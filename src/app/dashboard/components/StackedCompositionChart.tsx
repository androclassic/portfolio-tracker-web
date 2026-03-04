'use client';
import React, { useState, useCallback } from 'react';
import { getAssetColor, isFiatCurrency } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import { EChart } from '@/components/charts/echarts';
import { sliceStartIndexForIsoDates, sampleDataWithDates } from '@/lib/timeframe';
import { useDashboardData } from '../../DashboardDataProvider';
import type { EChartsOption } from 'echarts';

function formatUnits(v: number): string {
  if (v === 0) return '0';
  if (v >= 10000) return Math.round(v).toLocaleString('en-US');
  if (v >= 1000)  return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (v >= 1)     return parseFloat(v.toFixed(3)).toLocaleString('en-US', { maximumFractionDigits: 3 });
  return parseFloat(v.toPrecision(4)).toString();
}

export function StackedCompositionChart() {
  const { stacked, loadingTxs, loadingCurr, loadingHist } = useDashboardData();

  const [stackedMode, setStackedMode] = useState<'usd' | 'percent'>('usd');

  const colorFor = useCallback((asset: string): string => getAssetColor(asset), []);
  const isLoading = loadingTxs || loadingCurr || loadingHist;

  return (
    <ChartCard
      title="Portfolio Composition Over Time"
      headerActions={() => (
        <label className="chart-control">
          Mode
          <select value={stackedMode} onChange={e => setStackedMode(e.target.value as 'usd' | 'percent')}>
            <option value="usd">USD</option>
            <option value="percent">Percent</option>
          </select>
        </label>
      )}
    >
      {({ timeframe, expanded }) => {
        if (isLoading) {
          return <div className="chart-loading">Loading portfolio composition...</div>;
        }
        if (!stacked.dates.length) {
          return <div className="chart-empty">No portfolio composition data</div>;
        }

        const idx = sliceStartIndexForIsoDates(stacked.dates, timeframe);
        const dates = stacked.dates.slice(idx);

        const maxPoints = expanded ? 200 : 100;
        const sampledDates = sampleDataWithDates(dates, dates, maxPoints).dates;

        const cryptoAssets = Array.from(stacked.perAssetUsd.keys()).filter(asset => !isFiatCurrency(asset));

        // Build per-asset sampled data for tooltip
        const assetDataMap = new Map<string, { sampledY: number[]; sampledUnits: number[] }>();

        const series: EChartsOption['series'] = cryptoAssets.map(asset => {
          const usdValues = stacked.perAssetUsd.get(asset) || [];
          const unitValues = (stacked.perAssetUnits.get(asset) || []).slice(idx);
          const yData = stackedMode === 'usd'
            ? usdValues.slice(idx)
            : usdValues.slice(idx).map((value, i) => {
                const total = stacked.totals[i + idx] || 1;
                return total > 0 ? (value / total) * 100 : 0;
              });

          const sampledY = sampleDataWithDates(dates, yData, maxPoints).data as number[];
          const sampledUnits = sampleDataWithDates(dates, unitValues, maxPoints).data as number[];
          assetDataMap.set(asset, { sampledY, sampledUnits });

          return {
            type: 'line' as const,
            name: asset,
            data: sampledY,
            stack: 'total',
            areaStyle: {},
            showSymbol: false,
            lineStyle: { color: colorFor(asset), width: 1 },
            itemStyle: { color: colorFor(asset) },
          };
        });

        const option: EChartsOption = {
          xAxis: { type: 'category', data: sampledDates },
          yAxis: {
            type: 'value',
            name: stackedMode === 'usd' ? 'USD Value' : 'Percentage',
          },
          tooltip: {
            trigger: 'axis',
            formatter: (params: unknown) => {
              const ps = params as { seriesName: string; value: number; dataIndex: number; color: string }[];
              if (!Array.isArray(ps) || ps.length === 0) return '';
              const date = sampledDates[ps[0]!.dataIndex] ?? '';
              let html = `<b>${date}</b>`;
              // Show only non-zero entries
              for (const p of ps) {
                if (p.value <= 0) continue;
                const units = assetDataMap.get(p.seriesName)?.sampledUnits[p.dataIndex] ?? 0;
                const unitStr = formatUnits(units);
                if (stackedMode === 'usd') {
                  html += `<br/><span style="color:${p.color}">\u25CF</span> ${p.seriesName}: $${p.value.toLocaleString('en-US', { maximumFractionDigits: 2 })} (${unitStr} ${p.seriesName})`;
                } else {
                  html += `<br/><span style="color:${p.color}">\u25CF</span> ${p.seriesName}: ${p.value.toFixed(2)}% (${unitStr} ${p.seriesName})`;
                }
              }
              return html;
            },
          },
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
