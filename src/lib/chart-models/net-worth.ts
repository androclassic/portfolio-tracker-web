import type { LineChartModel } from '@/components/charts/types';

export type NetWorthOverTime = {
  dates: string[];
  totalValue: number[];
  cryptoValue: number[];
  cashValue: number[];
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
        name: 'Crypto Value',
        y: netWorth.cryptoValue,
        color: '#f59e0b',
        width: 2,
      },
      {
        id: 'cash',
        name: 'Cash Balance',
        y: netWorth.cashValue,
        color: '#10b981',
        width: 2,
      },
    ],
  };
}


