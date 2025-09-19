import { useMemo } from 'react';
import type { Transaction as Tx, PricePoint } from '@/lib/types';

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
  historicalPrices: PricePoint[]
): PnLData {
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

    // Create price map for historical data
    const priceMap = new Map<string, number>();
    historicalPrices.forEach(p => {
      priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);
    });

    // Get the most recent date for current prices
    const dates = Array.from(new Set(historicalPrices.map(p => p.date))).sort();

    // Calculate holdings and cost basis for each asset
    const holdings: Record<string, number> = {};
    const costBasis: Record<string, number> = {};
    const realizedPnL: Record<string, number> = {};

    // Process all transactions
    txs.forEach(tx => {
      if (tx.type === 'Buy') {
        holdings[tx.asset] = (holdings[tx.asset] || 0) + tx.quantity;
        costBasis[tx.asset] = (costBasis[tx.asset] || 0) + (tx.priceUsd || 0) * tx.quantity;
      } else if (tx.type === 'Sell') {
        const sellQuantity = Math.min(tx.quantity, holdings[tx.asset] || 0);
        const avgCost = holdings[tx.asset] > 0 ? (costBasis[tx.asset] || 0) / holdings[tx.asset] : 0;
        
        // Realize P&L on sale
        const sellValue = (tx.priceUsd || 0) * sellQuantity;
        const sellCost = avgCost * sellQuantity;
        const realizedGain = sellValue - sellCost;
        
        realizedPnL[tx.asset] = (realizedPnL[tx.asset] || 0) + realizedGain;
        
        // Update holdings and cost basis
        holdings[tx.asset] = (holdings[tx.asset] || 0) - sellQuantity;
        costBasis[tx.asset] = (costBasis[tx.asset] || 0) - sellCost;
      }
    });

    // Calculate current values and unrealized P&L
    const assetPnL: Record<string, { pnl: number; pnlPercent: number; costBasis: number; currentValue: number }> = {};
    let totalRealizedPnL = 0;
    let totalUnrealizedPnL = 0;
    let totalCostBasis = 0;

    Object.entries(holdings).forEach(([asset, quantity]) => {
      if (quantity > 0) {
        const currentPrice = currentPrices[asset] || 0;
        const currentValue = quantity * currentPrice;
        const assetCostBasis = costBasis[asset] || 0;
        const unrealizedPnL = currentValue - assetCostBasis;
        const totalAssetPnL = (realizedPnL[asset] || 0) + unrealizedPnL;
        const pnlPercent = assetCostBasis > 0 ? (totalAssetPnL / assetCostBasis) * 100 : 0;

        assetPnL[asset] = {
          pnl: totalAssetPnL,
          pnlPercent,
          costBasis: assetCostBasis,
          currentValue
        };

        totalRealizedPnL += realizedPnL[asset] || 0;
        totalUnrealizedPnL += unrealizedPnL;
        totalCostBasis += assetCostBasis;
      }
    });

    const totalPnL = totalRealizedPnL + totalUnrealizedPnL;
    const totalPnLPercent = totalCostBasis > 0 ? (totalPnL / totalCostBasis) * 100 : 0;

    return {
      totalPnL,
      totalPnLPercent,
      realizedPnL: totalRealizedPnL,
      unrealizedPnL: totalUnrealizedPnL,
      assetPnL
    };
  }, [txs, currentPrices, historicalPrices]);
}
