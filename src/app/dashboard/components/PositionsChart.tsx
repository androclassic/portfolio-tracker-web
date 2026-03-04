'use client';
import React, { useCallback, useMemo, useState } from 'react';
import { getAssetColor, isFiatCurrency } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import { EChart } from '@/components/charts/echarts';
import { sliceStartIndexForIsoDates, sampleDataWithDates } from '@/lib/timeframe';
import { useDashboardData } from '../../DashboardDataProvider';
import { useAutoSelectAsset } from '../lib/use-auto-select-asset';
import type { EChartsOption } from 'echarts';

export function PositionsChart() {
  const { txs, assets, dailyPos, notesByDayAsset, stacked, loadingTxs, loadingHist } = useDashboardData();

  const [selectedAsset, setSelectedAsset] = useAutoSelectAsset(assets);
  const [posMode, setPosMode] = useState<'usd' | 'units'>('usd');
  const colorFor = useCallback((asset: string): string => getAssetColor(asset), []);

  // Unit-based positions from dailyPos (step chart data)
  const unitPositions = useMemo(() => {
    const groups = new Map<string, { x: string[]; y: number[]; notes: string[] }>();
    for (const r of dailyPos) {
      if (isFiatCurrency(r.asset)) continue;
      const g = groups.get(r.asset) || { x: [], y: [], notes: [] };
      g.x.push(r.date);
      g.y.push(r.position);
      g.notes.push(notesByDayAsset.get(`${r.date}|${r.asset}`) || '');
      groups.set(r.asset, g);
    }

    if (selectedAsset && groups.has(selectedAsset)) {
      return [{ asset: selectedAsset, ...groups.get(selectedAsset)! }];
    }
    return Array.from(groups.entries()).map(([asset, g]) => ({ asset, ...g }));
  }, [dailyPos, selectedAsset, notesByDayAsset]);

  // USD-based positions from stacked data (daily granularity)
  const usdPositions = useMemo(() => {
    if (!stacked.dates.length) return [];
    const cryptoAssets = Array.from(stacked.perAssetUsd.keys()).filter(a => !isFiatCurrency(a));
    const targetAssets = selectedAsset && cryptoAssets.includes(selectedAsset)
      ? [selectedAsset]
      : cryptoAssets;

    return targetAssets.map(asset => {
      const usdValues = stacked.perAssetUsd.get(asset) || [];
      const unitValues = stacked.perAssetUnits.get(asset) || [];
      return {
        asset,
        x: stacked.dates,
        y: usdValues,
        units: unitValues,
      };
    });
  }, [stacked, selectedAsset]);

  const isLoading = loadingTxs || (posMode === 'usd' && loadingHist);

  return (
    <ChartCard
      title="Asset Positions Over Time"
      headerActions={() => (
        <>
          <label className="chart-control">
            Mode
            <select value={posMode} onChange={e => setPosMode(e.target.value as 'usd' | 'units')}>
              <option value="usd">USD</option>
              <option value="units">Units</option>
            </select>
          </label>
          <label className="chart-control">
            Asset
            <select value={selectedAsset} onChange={e => setSelectedAsset(e.target.value)}>
              <option value="">All Assets</option>
              {assets.filter(a => !isFiatCurrency(a)).map(a => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    >
      {({ timeframe, expanded }) => {
        if (isLoading || !txs) {
          return <div className="chart-loading">Loading positions...</div>;
        }

        const maxPoints = expanded ? 200 : 100;

        if (posMode === 'usd') {
          // USD mode: daily line chart from stacked data
          if (!usdPositions.length || !stacked.dates.length) {
            return <div className="chart-empty">No position data</div>;
          }

          const idx = sliceStartIndexForIsoDates(stacked.dates, timeframe);
          const dates = stacked.dates.slice(idx);
          const sampledDates = sampleDataWithDates(dates, dates, maxPoints).dates;

          // Build per-series unit data for tooltip
          const assetUnitsMap = new Map<string, number[]>();

          const series: EChartsOption['series'] = usdPositions
            .filter(({ y }) => {
              // Only include assets that have non-zero values in the time range
              const sliced = y.slice(idx);
              return sliced.some(v => v > 0);
            })
            .map(({ asset, y, units }) => {
              const slicedY = y.slice(idx);
              const slicedUnits = units.slice(idx);
              const sampledY = sampleDataWithDates(dates, slicedY, maxPoints).data as number[];
              const sampledUnits = sampleDataWithDates(dates, slicedUnits, maxPoints).data as number[];
              assetUnitsMap.set(asset, sampledUnits);

              const c = colorFor(asset);
              return {
                type: 'line' as const,
                name: asset,
                data: sampledY,
                showSymbol: usdPositions.length === 1,
                symbolSize: 5,
                lineStyle: { color: c },
                itemStyle: { color: c },
              };
            });

          if (!series.length) {
            return <div className="chart-empty">No position data</div>;
          }

          const option: EChartsOption = {
            xAxis: { type: 'category', data: sampledDates },
            yAxis: { type: 'value', name: 'USD Value' },
            tooltip: {
              trigger: 'axis',
              formatter: (params: unknown) => {
                const ps = params as { seriesName: string; value: number; dataIndex: number; color: string }[];
                if (!Array.isArray(ps) || ps.length === 0) return '';
                const date = sampledDates[ps[0]!.dataIndex] ?? '';
                let html = `<b>${date}</b>`;
                for (const p of ps) {
                  if (isNaN(p.value) || p.value <= 0) continue;
                  const units = assetUnitsMap.get(p.seriesName)?.[p.dataIndex] ?? 0;
                  const unitStr = units > 0 ? ` (${formatUnits(units)} ${p.seriesName})` : '';
                  html += `<br/><span style="color:${p.color}">\u25CF</span> ${p.seriesName}: $${p.value.toLocaleString('en-US', { maximumFractionDigits: 2 })}${unitStr}`;
                }
                return html;
              },
            },
            legend: { show: (series as unknown[]).length > 1 },
            series,
          };

          return (
            <EChart
              option={option}
              style={{ width: '100%', height: expanded ? '100%' : 320 }}
              notMerge
            />
          );
        }

        // Units mode: step chart from dailyPos
        if (!unitPositions.length) {
          return <div className="chart-empty">No position data</div>;
        }

        // Build a unified sorted date array across all assets
        const allDatesSet = new Set<string>();
        for (const { x } of unitPositions) {
          for (const d of x) allDatesSet.add(d);
        }
        const allDates = Array.from(allDatesSet).sort();

        const idx = sliceStartIndexForIsoDates(allDates, timeframe);
        const slicedDates = allDates.slice(idx);

        // Build per-series notes lookup for tooltip
        const seriesNotesMap: Record<string, (string | undefined)[]> = {};

        const series: EChartsOption['series'] = unitPositions.map(({ asset, x, y, notes }) => {
          // Build a date→{value, note} lookup for this asset
          const dateMap = new Map<string, { value: number; note: string }>();
          for (let i = 0; i < x.length; i++) {
            dateMap.set(x[i]!, { value: y[i]!, note: notes[i] ?? '' });
          }

          // Align data to the unified date array, carrying forward last known position (step chart)
          const alignedY: number[] = [];
          const alignedNotes: string[] = [];
          let lastVal = 0;
          let lastNote = '';
          let started = false;
          for (const date of slicedDates) {
            const entry = dateMap.get(date);
            if (entry) {
              lastVal = entry.value;
              lastNote = entry.note;
              started = true;
            }
            // Only emit values after this asset's first data point
            alignedY.push(started ? lastVal : NaN);
            alignedNotes.push(started ? lastNote : '');
          }

          // Sample if needed
          let sampledY = alignedY;
          let sampledNotes = alignedNotes;
          let sampledDates = slicedDates;
          if (slicedDates.length > maxPoints) {
            const sampled = sampleDataWithDates(slicedDates, alignedY, maxPoints);
            sampledDates = sampled.dates;
            sampledY = sampled.data as number[];
            const step = slicedDates.length / maxPoints;
            sampledNotes = Array.from({ length: sampledDates.length }, (_, i) =>
              alignedNotes[Math.min(Math.round(i * step), alignedNotes.length - 1)] ?? ''
            );
          }

          seriesNotesMap[asset] = sampledNotes;

          const c = colorFor(asset);
          return {
            type: 'line' as const,
            name: asset,
            step: 'start' as const,
            data: sampledY,
            showSymbol: unitPositions.length === 1,
            symbolSize: 5,
            lineStyle: { color: c },
            itemStyle: { color: c },
            connectNulls: false,
          };
        });

        // Sample unified dates for x-axis
        const sampledXData = slicedDates.length > maxPoints
          ? sampleDataWithDates(slicedDates, slicedDates, maxPoints).dates
          : slicedDates;

        const option: EChartsOption = {
          xAxis: { type: 'category', data: sampledXData },
          yAxis: { type: 'value', name: 'Units' },
          tooltip: {
            trigger: 'axis',
            formatter: (params: unknown) => {
              const ps = params as { seriesName: string; value: number; dataIndex: number; color: string }[];
              if (!Array.isArray(ps) || ps.length === 0) return '';
              const date = sampledXData[ps[0]!.dataIndex] ?? '';
              let html = `<b>${date}</b>`;
              for (const p of ps) {
                if (isNaN(p.value)) continue;
                const note = seriesNotesMap[p.seriesName]?.[p.dataIndex] ?? '';
                html += `<br/><span style="color:${p.color}">\u25CF</span> ${p.seriesName}: ${formatUnits(p.value)}`;
                if (note) html += `<br/><span style="color:var(--muted);font-size:11px">${note}</span>`;
              }
              return html;
            },
          },
          legend: { show: unitPositions.length > 1 },
          series,
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

function formatUnits(v: number): string {
  if (v === 0) return '0';
  if (v >= 10000) return Math.round(v).toLocaleString('en-US');
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 1 });
  if (v >= 1) return parseFloat(v.toFixed(3)).toLocaleString('en-US', { maximumFractionDigits: 3 });
  return parseFloat(v.toPrecision(4)).toString();
}
