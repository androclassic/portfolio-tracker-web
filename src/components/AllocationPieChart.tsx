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
  totalCashBalanceUsd?: number;
  isLoading?: boolean;
  height?: number;
}

export default function AllocationPieChart({ 
  data, 
  totalCashBalanceUsd = 0, 
  isLoading = false, 
  height = 320 
}: AllocationPieChartProps) {
  const model = React.useMemo((): PieChartModel => {
    // Add cash if there's a positive balance
    const points = [...data];
    if (totalCashBalanceUsd > 0) {
      points.push({ asset: 'Cash', units: totalCashBalanceUsd, value: totalCashBalanceUsd });
    }
    
    return {
      height,
      hole: 0.45,
      slices: points.map((p) => ({
        id: p.asset,
        label: p.asset,
        value: p.value,
        color: p.asset === 'Cash' ? '#16a34a' : getAssetColor(p.asset),
        meta: { units: p.units },
      })),
    };
  }, [data, totalCashBalanceUsd, height]);

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
