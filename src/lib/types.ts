// Stablecoins are treated as crypto (not fiat) but used as the base currency for swaps
export const STABLECOINS = ['USDC', 'USDT', 'DAI', 'BUSD', 'EURC'] as const;

// Helper to check if an asset is a stablecoin
export function isStablecoin(asset: string): boolean {
  return (STABLECOINS as readonly string[]).includes(asset.toUpperCase());
}

export type Transaction = {
  id: number;
  type: 'Deposit' | 'Withdrawal' | 'Swap';
  datetime: string;
  feesUsd?: number | null;
  notes?: string | null;
  
  // For Swap transactions: what you give up (null for Deposit/Withdrawal)
  fromAsset?: string | null;
  fromQuantity?: number | null;
  fromPriceUsd?: number | null;
  
  // What you receive/move (always populated)
  toAsset: string;
  toQuantity: number;
  toPriceUsd?: number | null;
  
  // Optional on client: present when fetching from API that includes portfolio linkage
  portfolioId?: number;
};

// Helper functions for working with transactions
export const TransactionHelpers = {
  // Get the USD cost of a transaction (what you spent)
  getCostUsd: (tx: Transaction): number => {
    if (tx.fromAsset && tx.fromQuantity && tx.fromPriceUsd) {
      return tx.fromQuantity * tx.fromPriceUsd;
    }
    return 0;
  },
  
  // Get the USD proceeds of a transaction (what you received in USD value)
  getProceedsUsd: (tx: Transaction): number => {
    if (tx.toQuantity && tx.toPriceUsd) {
      return tx.toQuantity * tx.toPriceUsd;
    }
    return 0;
  },
  
  // Get the crypto asset involved (for buy/sell logic)
  getCryptoAsset: (tx: Transaction): string => {
    // For swaps, the crypto asset is the non-stablecoin
    if (tx.type === 'Swap') {
      if (tx.fromAsset && !isStablecoin(tx.fromAsset)) {
        return tx.fromAsset; // Selling crypto
      }
      return tx.toAsset; // Buying crypto
    }
    return tx.toAsset;
  },
  
  // Get the crypto quantity involved
  getCryptoQuantity: (tx: Transaction): number => {
    if (tx.type === 'Swap') {
      if (tx.fromAsset && !isStablecoin(tx.fromAsset)) {
        return tx.fromQuantity || 0; // Selling crypto
      }
      return tx.toQuantity; // Buying crypto
    }
    return tx.toQuantity;
  },
  
  // Get the crypto price in USD
  getCryptoPrice: (tx: Transaction): number | null => {
    if (tx.type === 'Swap') {
      if (tx.fromAsset && !isStablecoin(tx.fromAsset)) {
        return tx.fromPriceUsd || null; // Selling crypto
      }
      return tx.toPriceUsd || null; // Buying crypto
    }
    return tx.toPriceUsd || null;
  },
  
  // Check if this is a taxable withdrawal (crypto → fiat)
  // In Romania, only withdrawals are taxable, not crypto-to-crypto swaps
  isTaxableEvent: (tx: Transaction): boolean => {
    return tx.type === 'Withdrawal';
  },
  
  // Get all assets involved in the transaction (for portfolio tracking)
  getInvolvedAssets: (tx: Transaction): string[] => {
    const assets: string[] = [];
    if (tx.fromAsset) assets.push(tx.fromAsset);
    if (tx.toAsset) assets.push(tx.toAsset);
    return assets;
  },
  
  // Get the value in USD of what was given up (for cost basis tracking)
  getFromValueUsd: (tx: Transaction): number => {
    if (!tx.fromAsset || !tx.fromQuantity || !tx.fromPriceUsd) return 0;
    return tx.fromQuantity * tx.fromPriceUsd;
  },
  
  // Get the value in USD of what was received (for cost basis tracking)
  getToValueUsd: (tx: Transaction): number => {
    if (!tx.toQuantity || !tx.toPriceUsd) return 0;
    return tx.toQuantity * tx.toPriceUsd;
  },
};

export type PricePoint = { date: string; asset: string; price_usd: number };

export type PricesResp = { prices: Record<string, number> };

export type HistResp = { prices: PricePoint[] };


