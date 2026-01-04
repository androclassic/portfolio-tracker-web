import type { LineChartModel } from '@/components/charts/types';

export type NetWorthOverTime = {
  dates: string[];
  totalValue: number[];
  cryptoExStableValue: number[];
  stableValue: number[];
};

export function buildNetWorthLineChartModel(netWorth: NetWorthOverTime): LineChartModel {
  return {
    title: 'Total Net Worth Over Time',
    x: netWorth.dates,
    xAxisTitle: 'Date',
    yAxisTitle: 'Value (USD)',
    height: 400,
    hovermode: 'x unified',
    series: [
      {
        id: 'total',
        name: 'Total Net Worth',
        y: netWorth.totalValue,
        color: '#3b82f6',
        width: 3,
      },
      {
        id: 'crypto',
        name: 'Crypto (ex Stablecoins)',
        y: netWorth.cryptoExStableValue,
        color: '#f59e0b',
        width: 2,
      },
      {
        id: 'stables',
        name: 'Stablecoin Balance',
        y: netWorth.stableValue,
        color: '#22c55e',
        width: 2,
      },
    ],
  };
}


