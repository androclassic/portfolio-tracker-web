import { SupportedAsset } from './assets';

// Get current date in YYYY-MM-DD format for datetime-local input
export function getCurrentDate(): string {
  const now = new Date();
  // Adjust for local timezone
  const localDate = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
  return localDate.toISOString().slice(0, 16); // YYYY-MM-DDTHH:MM
}

// Get current date in YYYY-MM-DD format for date input
export function getCurrentDateOnly(): string {
  const now = new Date();
  return now.toISOString().split('T')[0]; // YYYY-MM-DD
}

// Fetch current price for an asset
export async function getCurrentPrice(symbol: string): Promise<number | null> {
  try {
    const response = await fetch(`/api/prices/current?symbols=${symbol.toUpperCase()}`);
    if (!response.ok) return null;
    
    const data = await response.json();
    const prices = data.prices || {};
    return prices[symbol.toUpperCase()] || null;
  } catch (error) {
    console.error('Failed to fetch current price:', error);
    return null;
  }
}

// Auto-fill transaction data when asset is selected
export interface TransactionDefaults {
  datetime: string;
  priceUsd: string;
  asset: string;
}

export async function getTransactionDefaults(asset: SupportedAsset | null): Promise<TransactionDefaults> {
  const datetime = getCurrentDate();
  let priceUsd = '';
  let assetSymbol = '';

  if (asset) {
    assetSymbol = asset.symbol;
    const currentPrice = await getCurrentPrice(asset.symbol);
    if (currentPrice) {
      // Format price with appropriate decimal places
      if (currentPrice >= 1) {
        priceUsd = currentPrice.toFixed(2);
      } else if (currentPrice >= 0.01) {
        priceUsd = currentPrice.toFixed(4);
      } else {
        priceUsd = currentPrice.toFixed(8);
      }
    }
  }

  return {
    datetime,
    priceUsd,
    asset: assetSymbol,
  };
}
