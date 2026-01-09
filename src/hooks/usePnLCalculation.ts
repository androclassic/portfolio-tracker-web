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
    // Note: For PORTFOLIO tracking, we calculate P&L on swaps based on USD values (opportunity cost)
    // This is different from TAX calculations where crypto-to-crypto swaps are not taxable in Romania
    txs.forEach(tx => {
      if (tx.type === 'Swap' && tx.fromAsset && tx.fromQuantity && tx.fromPriceUsd) {
        // Swap transaction: exchange one asset for another
        const fromAsset = tx.fromAsset;
        const toAsset = tx.toAsset;
        
        // Remove from source asset
        const fromQty = Math.min(tx.fromQuantity, holdings[fromAsset] || 0);
        const avgCost = holdings[fromAsset] > 0 ? (costBasis[fromAsset] || 0) / holdings[fromAsset] : 0;
        const transferredCost = avgCost * fromQty;
        
        holdings[fromAsset] = (holdings[fromAsset] || 0) - fromQty;
        costBasis[fromAsset] = (costBasis[fromAsset] || 0) - transferredCost;
        
        // Calculate realized P&L from this swap (USD opportunity cost)
        const valueReceived = tx.toQuantity * (tx.toPriceUsd || 0); // What you got in USD
        const realizedGain = valueReceived - transferredCost; // Gain/loss vs your cost basis
        
        realizedPnL[fromAsset] = (realizedPnL[fromAsset] || 0) + realizedGain;
        
        // Add to target asset with NEW cost basis = current USD value
        holdings[toAsset] = (holdings[toAsset] || 0) + tx.toQuantity;
        costBasis[toAsset] = (costBasis[toAsset] || 0) + valueReceived;
        
      } else if (tx.type === 'Deposit') {
        // Deposits add to holdings (fiat → crypto)
        holdings[tx.toAsset] = (holdings[tx.toAsset] || 0) + tx.toQuantity;
        // Deposits establish cost basis at the deposit value
        const cost = tx.toQuantity * (tx.toPriceUsd || 1);
        costBasis[tx.toAsset] = (costBasis[tx.toAsset] || 0) + cost;
        
      } else if (tx.type === 'Withdrawal') {
        // Withdrawals remove from holdings (crypto → fiat)
        // This is the ONLY taxable event in Romanian tax law
        const withdrawQuantity = Math.min(tx.toQuantity, holdings[tx.toAsset] || 0);
        const avgCost = holdings[tx.toAsset] > 0 ? (costBasis[tx.toAsset] || 0) / holdings[tx.toAsset] : 0;
        
        // Realize P&L on withdrawal
        const withdrawValue = tx.toQuantity * (tx.toPriceUsd || 1);
        const withdrawCost = avgCost * withdrawQuantity;
        const realizedGain = withdrawValue - withdrawCost;
        
        realizedPnL[tx.toAsset] = (realizedPnL[tx.toAsset] || 0) + realizedGain;
        
        // Update holdings and cost basis
        holdings[tx.toAsset] = (holdings[tx.toAsset] || 0) - withdrawQuantity;
        costBasis[tx.toAsset] = (costBasis[tx.toAsset] || 0) - withdrawCost;
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
