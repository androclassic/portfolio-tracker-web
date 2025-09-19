import React from 'react';
import dynamic from 'next/dynamic';
import { getAssetColor } from '@/lib/assets';
import type { Layout, Data } from 'plotly.js';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

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
  const chartData = React.useMemo(() => {
    // Add cash if there's a positive balance
    const points = [...data];
    if (totalCashBalanceUsd > 0) {
      points.push({ asset: 'Cash', units: totalCashBalanceUsd, value: totalCashBalanceUsd });
    }
    
    const labels = points.map(p => p.asset);
    const plotData: Data[] = [{ 
      type: 'pie', 
      labels, 
      values: points.map(p => p.value), 
      customdata: points.map(p => [p.units]),
      hovertemplate: '<b>%{label}</b><br>Holdings: %{customdata[0]:.6f}<br>Value: %{value:$,.2f}<extra></extra>',
      hole: 0.45, 
      marker: { colors: labels.map(a => a === 'Cash' ? '#16a34a' : getAssetColor(a)) } 
    } as unknown as Data];
    
    const layout: Partial<Layout> = { 
      autosize: true, 
      height, 
      margin: { t: 30, r: 10, l: 10, b: 10 } 
    };
    
    return { data: plotData, layout };
  }, [data, totalCashBalanceUsd, height]);

  if (isLoading) {
    return (
      <div style={{ padding: 16, color: 'var(--muted)' }}>
        Loading allocation...
      </div>
    );
  }

  if (chartData.data.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--muted)' }}>
        No allocation data
      </div>
    );
  }

  return (
    <Plot 
      data={chartData.data} 
      layout={chartData.layout} 
      style={{ width: '100%' }} 
    />
  );
}
