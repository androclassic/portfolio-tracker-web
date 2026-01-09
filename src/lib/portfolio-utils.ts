import { Transaction as Tx, PricePoint, TransactionHelpers } from '@/lib/types';
import { SUPPORTED_ASSETS } from '@/lib/assets';

export interface HoldingData {
  asset: string;
  name: string;
  quantity: number;
  currentPrice: number;
  currentValue: number;
  btcValue: number;
  marketCap: number;
  avgCost: number;
  costBasis: number;
  pnl: number;
  pnlPercent: number;
  color: string;
}

export interface PortfolioSummary {
  totalValue: number;
  totalPnl: number;
  totalPnlPercent: number;
  assetCount: number;
}

// Helper function to get asset name
export const getAssetName = (symbol: string): string => {
  const asset = SUPPORTED_ASSETS.find(a => a.symbol === symbol);
  return asset ? asset.name : symbol;
};

// Calculate current holdings from transactions
export const calculateHoldings = (txs: Tx[]): Record<string, number> => {
  const holdings: Record<string, number> = {};
  
  txs.forEach(tx => {
    if (tx.type === 'Swap') {
      // For swaps, update both assets
      if (tx.fromAsset) {
        holdings[tx.fromAsset] = (holdings[tx.fromAsset] || 0) - (tx.fromQuantity || 0);
      }
      holdings[tx.toAsset] = (holdings[tx.toAsset] || 0) + tx.toQuantity;
    } else if (tx.type === 'Deposit') {
      // Deposit adds to holdings
      holdings[tx.toAsset] = (holdings[tx.toAsset] || 0) + tx.toQuantity;
    } else if (tx.type === 'Withdrawal') {
      // Withdrawal removes from holdings
      holdings[tx.toAsset] = (holdings[tx.toAsset] || 0) - tx.toQuantity;
    }
  });
  
  return holdings;
};

// Calculate cost basis for an asset
export const calculateCostBasis = (asset: string, txs: Tx[]): { avgCost: number; costBasis: number } => {
  // Filter transactions where we're acquiring this asset (including deposits)
  const acquisitionTxs = txs.filter(tx => 
    (tx.type === 'Swap' && tx.toAsset === asset) ||
    (tx.type === 'Deposit' && tx.toAsset === asset)
  );
  
  let totalCost = 0;
  let totalQuantity = 0;
  
  acquisitionTxs.forEach(tx => {
    if (tx.type === 'Swap') {
      totalCost += TransactionHelpers.getFromValueUsd(tx);
      totalQuantity += tx.toQuantity;
    } else if (tx.type === 'Deposit') {
      totalCost += TransactionHelpers.getToValueUsd(tx);
      totalQuantity += tx.toQuantity;
    }
  });
  
  const avgCost = totalQuantity > 0 ? totalCost / totalQuantity : 0;
  const costBasis = totalQuantity * avgCost;
  
  return { avgCost, costBasis };
};

// Get market cap from historical data (placeholder - PricePoint doesn't include market cap)
export const getMarketCap = (asset: string, histPrices: PricePoint[]): number => {
  // Note: PricePoint type doesn't include market_cap, so we return 0 for now
  // This could be enhanced to fetch market cap from a separate API
  return 0;
};

// Calculate P&L for a holding
export const calculatePnL = (currentValue: number, costBasis: number): { pnl: number; pnlPercent: number } => {
  const pnl = currentValue - costBasis;
  const pnlPercent = costBasis > 0 ? (pnl / costBasis) * 100 : 0;
  
  return { pnl, pnlPercent };
};

// Format currency values
export const formatCurrency = (value: number, decimals: number = 2): string => {
  return value.toLocaleString('en-US', { 
    minimumFractionDigits: decimals, 
    maximumFractionDigits: decimals 
  });
};

// Format BTC values
export const formatBTC = (value: number, decimals: number = 6): string => {
  return value.toLocaleString('en-US', { 
    minimumFractionDigits: decimals, 
    maximumFractionDigits: 8 
  });
};

// Format market cap values
export const formatMarketCap = (value: number): string => {
  if (value === 0) return 'N/A';
  
  if (value >= 1e12) {
    return `$${(value / 1e12).toFixed(2)}T`;
  } else if (value >= 1e9) {
    return `$${(value / 1e9).toFixed(2)}B`;
  } else if (value >= 1e6) {
    return `$${(value / 1e6).toFixed(2)}M`;
  } else {
    return `$${formatCurrency(value, 0)}`;
  }
};
