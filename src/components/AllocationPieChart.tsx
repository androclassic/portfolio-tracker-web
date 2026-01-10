 'use client';

import React from 'react';
import { getAssetColor } from '@/lib/assets';
import { PieChart } from '@/components/charts/PieChart';
import type { PieChartModel } from '@/components/charts/types';

interface AllocationData {
  asset: string;
  units: number;
  value: number;
}

interface AllocationPieChartProps {
  data: AllocationData[];
  isLoading?: boolean;
  height?: number;
}

export default function AllocationPieChart({ 
  data, 
  isLoading = false, 
  height = 320 
}: AllocationPieChartProps) {
  const model = React.useMemo((): PieChartModel => {
    // Don't add cash - it's already included in stablecoins
    return {
      height,
      hole: 0.45,
      slices: data.map((p) => ({
        id: p.asset,
        label: p.asset,
        value: p.value,
        color: getAssetColor(p.asset),
        meta: { units: p.units },
      })),
    };
  }, [data, height]);

  if (isLoading) {
    return (
      <div style={{ padding: 16, color: 'var(--muted)' }}>
        Loading allocation...
      </div>
    );
  }

  if (model.slices.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--muted)' }}>
        No allocation data
      </div>
    );
  }

  return (
    <PieChart
      model={model}
      getHoverText={(slice) => {
        const units = Number((slice.meta?.units as number | undefined) ?? 0);
        const value = Number(slice.value ?? 0);
        return `<b>${slice.label}</b><br>Holdings: ${units.toFixed(6)}<br>Value: $${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
      }}
    />
  );
}
