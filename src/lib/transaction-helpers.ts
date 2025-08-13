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

// Validate transaction data
export interface TransactionValidation {
  isValid: boolean;
  errors: string[];
}

export function validateTransaction(data: {
  asset: string;
  type: string;
  quantity: number | string;
  priceUsd?: string;
  datetime: string;
}): TransactionValidation {
  const errors: string[] = [];

  // Asset validation
  if (!data.asset || data.asset.trim().length === 0) {
    errors.push('Asset is required');
  }

  // Type validation
  if (!data.type || !['Buy', 'Sell'].includes(data.type)) {
    errors.push('Transaction type must be Buy or Sell');
  }

  // Quantity validation
  const quantity = typeof data.quantity === 'string' ? parseFloat(data.quantity) : data.quantity;
  if (!quantity || quantity <= 0) {
    errors.push('Quantity must be greater than 0');
  }

  // Price validation (optional but if provided must be valid)
  if (data.priceUsd) {
    const price = parseFloat(data.priceUsd);
    if (isNaN(price) || price < 0) {
      errors.push('Price must be a valid positive number');
    }
  }

  // Date validation
  if (!data.datetime) {
    errors.push('Date is required');
  } else {
    const date = new Date(data.datetime);
    if (isNaN(date.getTime())) {
      errors.push('Invalid date format');
    }
    // Check if date is not in the future (with 1 hour buffer for timezone issues)
    const now = new Date();
    const maxDate = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour buffer
    if (date > maxDate) {
      errors.push('Transaction date cannot be in the future');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Format price for display
export function formatPrice(price: number | string | null): string {
  if (price === null || price === undefined || price === '') return '';
  
  const numPrice = typeof price === 'string' ? parseFloat(price) : price;
  if (isNaN(numPrice)) return '';

  if (numPrice >= 1000) {
    return numPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } else if (numPrice >= 1) {
    return numPrice.toFixed(2);
  } else if (numPrice >= 0.01) {
    return numPrice.toFixed(4);
  } else {
    return numPrice.toFixed(8);
  }
}

// Calculate cost/proceeds automatically
export function calculateTransactionValue(
  type: 'Buy' | 'Sell',
  quantity: number | string,
  price: number | string
): { costUsd?: number; proceedsUsd?: number } {
  const qty = typeof quantity === 'string' ? parseFloat(quantity) : quantity;
  const prc = typeof price === 'string' ? parseFloat(price) : price;

  if (isNaN(qty) || isNaN(prc) || qty <= 0 || prc < 0) {
    return {};
  }

  const total = qty * prc;
  
  if (type === 'Buy') {
    return { costUsd: total };
  } else {
    return { proceedsUsd: total };
  }
}
