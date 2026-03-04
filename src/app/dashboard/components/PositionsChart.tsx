'use client';
import React, { useCallback, useMemo } from 'react';
import { getAssetColor } from '@/lib/assets';
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
          return <div className="chart-loading">Loading positions...</div>;
        }
        if (!positionsData.length) {
          return <div className="chart-empty">No position data</div>;
        }

        const firstX = positionsData[0]?.x;
        const idx = firstX ? sliceStartIndexForIsoDates(firstX, timeframe) : 0;

        const maxPoints = expanded ? 200 : 100;

        const series: EChartsOption['series'] = positionsData.map(({ asset, x, y, notes }) => {
          const slicedX = x.slice(idx);
          const slicedY = y.slice(idx);
          const slicedNotes = notes.slice(idx);

          let sampledX = slicedX;
          let sampledY = slicedY;
          let sampledNotes = slicedNotes;

          if (slicedX.length > maxPoints) {
            const sampled = sampleDataWithDates(slicedX, slicedY, maxPoints);
            sampledX = sampled.dates;
            sampledY = sampled.data as number[];
            // Sample notes at matching indices
            const step = slicedX.length / maxPoints;
            sampledNotes = Array.from({ length: sampledX.length }, (_, i) =>
              slicedNotes[Math.min(Math.round(i * step), slicedNotes.length - 1)] ?? ''
            );
          }

          const c = colorFor(asset);
          return {
            type: 'line' as const,
            name: asset,
            step: 'start' as const,
            data: sampledY,
            showSymbol: true,
            symbolSize: 5,
            lineStyle: { color: c },
            itemStyle: { color: c },
            _notes: sampledNotes,
            _xData: sampledX,
          };
        });

        // Use the x-axis data from the first series
        const xData = (positionsData[0]?.x ?? []).slice(idx);
        const sampledXData = xData.length > maxPoints
          ? sampleDataWithDates(xData, xData, maxPoints).dates
          : xData;

        const option: EChartsOption = {
          xAxis: { type: 'category', data: sampledXData },
          yAxis: { type: 'value' },
          tooltip: {
            trigger: 'axis',
            formatter: (params: unknown) => {
              const ps = params as { seriesName: string; value: number; dataIndex: number; color: string; series: { _notes?: string[] } }[];
              if (!Array.isArray(ps) || ps.length === 0) return '';
              const date = sampledXData[ps[0]!.dataIndex] ?? '';
              let html = `<b>${date}</b>`;
              for (const p of ps) {
                const note = (series as { _notes?: string[] }[])[0]?._notes?.[p.dataIndex] ?? '';
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
