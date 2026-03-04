import { useMemo } from 'react';
import type { Transaction as Tx, PricePoint } from '@/lib/types';
import {
  buildAssetPositions,
  valueAssetPositions,
  type PortfolioTransactionLike,
} from '@/lib/portfolio-engine';

export interface PnLData {
  totalPnL: number;
  totalPnLPercent: number;
  realizedPnL: number;
  unrealizedPnL: number;
  assetPnL: Record<string, { pnl: number; pnlPercent: number; costBasis: number; currentValue: number }>;
}

const EMPTY_PNL: PnLData = {
  totalPnL: 0,
  totalPnLPercent: 0,
  realizedPnL: 0,
  unrealizedPnL: 0,
  assetPnL: {},
};

export function computePnL(
  txs: PortfolioTransactionLike[] | undefined,
  currentPrices: Record<string, number>,
): PnLData {
  if (!txs || !currentPrices || Object.keys(currentPrices).length === 0) {
    return EMPTY_PNL;
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
    assetPnL,
  };
}

export function usePnLCalculation(
  txs: Tx[] | undefined,
  currentPrices: Record<string, number>,
  _historicalPrices: PricePoint[]
): PnLData {
  void _historicalPrices;
  return useMemo(() => computePnL(txs, currentPrices), [txs, currentPrices]);
}
