import { useMemo } from 'react';
import type { Transaction as Tx, PricePoint } from '@/lib/types';
import {
  buildAssetPositions,
  valueAssetPositions,
} from '@/lib/portfolio-engine';

interface PnLData {
  totalPnL: number;
  totalPnLPercent: number;
  realizedPnL: number;
  unrealizedPnL: number;
  assetPnL: Record<string, { pnl: number; pnlPercent: number; costBasis: number; currentValue: number }>;
}

export function usePnLCalculation(
  txs: Tx[] | undefined,
  currentPrices: Record<string, number>,
  _historicalPrices: PricePoint[]
): PnLData {
  void _historicalPrices;
  return useMemo(() => {
    if (!txs || !currentPrices || Object.keys(currentPrices).length === 0) {
      return {
        totalPnL: 0,
        totalPnLPercent: 0,
        realizedPnL: 0,
        unrealizedPnL: 0,
        assetPnL: {}
      };
    }

    const positions = buildAssetPositions(txs);
    const { holdings, summary } = valueAssetPositions(positions, currentPrices);

    const assetPnL: Record<
      string,
      { pnl: number; pnlPercent: number; costBasis: number; currentValue: number }
    > = {};
    for (const holding of holdings) {
      assetPnL[holding.asset] = {
        pnl: holding.totalPnl,
        pnlPercent: holding.totalPnlPercent,
        costBasis: holding.costBasis,
        currentValue: holding.currentValue,
      };
    }

    return {
      totalPnL: summary.totalNetPnl,
      totalPnLPercent: summary.totalNetPnlPercent,
      realizedPnL: summary.totalRealizedPnl,
      unrealizedPnL: summary.totalUnrealizedPnl,
      assetPnL
    };
  }, [txs, currentPrices]);
}
