'use client';
import React, { useCallback, useMemo } from 'react';
import { getAssetColor, isFiatCurrency } from '@/lib/assets';
import { ChartCard } from '@/components/ChartCard';
import { EChart } from '@/components/charts/echarts';
import { sliceStartIndexForIsoDates, sampleDataWithDates } from '@/lib/timeframe';
import { useDashboardData } from '../../DashboardDataProvider';
import { useAutoSelectAsset } from '../lib/use-auto-select-asset';
import type { EChartsOption } from 'echarts';

export function PositionsChart() {
  const { txs, assets, dailyPos, notesByDayAsset, loadingTxs } = useDashboardData();

  const [selectedAsset, setSelectedAsset] = useAutoSelectAsset(assets);
  const colorFor = useCallback((asset: string): string => getAssetColor(asset), []);

  const positionsData = useMemo(() => {
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

  return (
    <ChartCard
      title="Asset Positions Over Time"
      headerActions={() => (
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
      )}
    >
      {({ timeframe, expanded }) => {
        if (loadingTxs || !txs) {
          return <div className="chart-loading">Loading positions...</div>;
        }
        if (!positionsData.length) {
          return <div className="chart-empty">No position data</div>;
        }

        // Build a unified sorted date array across all assets
        const allDatesSet = new Set<string>();
        for (const { x } of positionsData) {
          for (const d of x) allDatesSet.add(d);
        }
        const allDates = Array.from(allDatesSet).sort();

        const idx = sliceStartIndexForIsoDates(allDates, timeframe);
        const slicedDates = allDates.slice(idx);
        const maxPoints = expanded ? 200 : 100;

        // Build per-series notes lookup for tooltip
        const seriesNotesMap: Record<string, (string | undefined)[]> = {};

        const series: EChartsOption['series'] = positionsData.map(({ asset, x, y, notes }) => {
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
            showSymbol: positionsData.length === 1,
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
          yAxis: { type: 'value' },
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
                html += `<br/><span style="color:${p.color}">\u25CF</span> ${p.seriesName}: ${p.value}`;
                if (note) html += `<br/><span style="color:var(--muted);font-size:11px">${note}</span>`;
              }
              return html;
            },
          },
          legend: { show: positionsData.length > 1 },
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
