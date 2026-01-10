// Top 20 cryptocurrencies by market cap (as of 2024)
// This list should be updated periodically to reflect market changes

export interface SupportedAsset {
  symbol: string;
  name: string;
  marketCapRank: number;
  category: 'major' | 'altcoin' | 'stablecoin' | 'fiat';
}

export const SUPPORTED_ASSETS: SupportedAsset[] = [
  { symbol: 'BTC', name: 'Bitcoin', marketCapRank: 1, category: 'major' },
  { symbol: 'ETH', name: 'Ethereum', marketCapRank: 2, category: 'major' },
  { symbol: 'USDT', name: 'Tether', marketCapRank: 3, category: 'stablecoin' },
  { symbol: 'BNB', name: 'BNB', marketCapRank: 4, category: 'altcoin' },
  { symbol: 'SOL', name: 'Solana', marketCapRank: 5, category: 'altcoin' },
  { symbol: 'USDC', name: 'USD Coin', marketCapRank: 6, category: 'stablecoin' },
  { symbol: 'XRP', name: 'XRP', marketCapRank: 7, category: 'altcoin' },
  { symbol: 'DOGE', name: 'Dogecoin', marketCapRank: 8, category: 'altcoin' },
  { symbol: 'ADA', name: 'Cardano', marketCapRank: 9, category: 'altcoin' },
  { symbol: 'AVAX', name: 'Avalanche', marketCapRank: 10, category: 'altcoin' },
  { symbol: 'SHIB', name: 'Shiba Inu', marketCapRank: 11, category: 'altcoin' },
  { symbol: 'DOT', name: 'Polkadot', marketCapRank: 12, category: 'altcoin' },
  { symbol: 'LINK', name: 'Chainlink', marketCapRank: 13, category: 'altcoin' },
  { symbol: 'TRX', name: 'TRON', marketCapRank: 14, category: 'altcoin' },
  { symbol: 'MATIC', name: 'Polygon', marketCapRank: 15, category: 'altcoin' },
  { symbol: 'ICP', name: 'Internet Computer', marketCapRank: 16, category: 'altcoin' },
  { symbol: 'UNI', name: 'Uniswap', marketCapRank: 17, category: 'altcoin' },
  { symbol: 'LTC', name: 'Litecoin', marketCapRank: 18, category: 'altcoin' },
  { symbol: 'ATOM', name: 'Cosmos', marketCapRank: 19, category: 'altcoin' },
  { symbol: 'SUI', name: 'Sui', marketCapRank: 20, category: 'altcoin' },
  { symbol: 'NIGHT', name: 'Midnight', marketCapRank: 0, category: 'altcoin' },
  // Fiat currencies
  { symbol: 'USD', name: 'US Dollar', marketCapRank: 0, category: 'fiat' },
  { symbol: 'EUR', name: 'Euro', marketCapRank: 0, category: 'fiat' },
  { symbol: 'RON', name: 'Romanian Leu', marketCapRank: 0, category: 'fiat' },
];

// Create lookup maps for efficient searching
export const ASSET_SYMBOL_MAP = new Map(
  SUPPORTED_ASSETS.map(asset => [asset.symbol.toUpperCase(), asset])
);

export const ASSET_NAME_MAP = new Map(
  SUPPORTED_ASSETS.map(asset => [asset.name.toLowerCase(), asset])
);

// Search function for autocomplete
export function searchAssets(query: string): SupportedAsset[] {
  if (!query || query.length < 1) return SUPPORTED_ASSETS.slice(0, 10);
  
  const searchTerm = query.toLowerCase().trim();
  
  return SUPPORTED_ASSETS.filter(asset => 
    asset.symbol.toLowerCase().includes(searchTerm) ||
    asset.name.toLowerCase().includes(searchTerm)
  ).sort((a, b) => {
    // Prioritize exact symbol matches
    if (a.symbol.toLowerCase() === searchTerm) return -1;
    if (b.symbol.toLowerCase() === searchTerm) return 1;
    
    // Then prioritize symbol starts with
    if (a.symbol.toLowerCase().startsWith(searchTerm)) return -1;
    if (b.symbol.toLowerCase().startsWith(searchTerm)) return 1;
    
    // Then by market cap rank
    return a.marketCapRank - b.marketCapRank;
  });
}

// Validation functions
export function isAssetSupported(symbol: string): boolean {
  return ASSET_SYMBOL_MAP.has(symbol.toUpperCase());
}

export function getAssetBySymbol(symbol: string): SupportedAsset | undefined {
  return ASSET_SYMBOL_MAP.get(symbol.toUpperCase());
}

export function validateAssetList(symbols: string[]): {
  supported: string[];
  unsupported: string[];
  supportedAssets: SupportedAsset[];
} {
  const supported: string[] = [];
  const unsupported: string[] = [];
  const supportedAssets: SupportedAsset[] = [];
  
  symbols.forEach(symbol => {
    const upperSymbol = symbol.toUpperCase().trim();
    if (isAssetSupported(upperSymbol)) {
      supported.push(upperSymbol);
      const asset = getAssetBySymbol(upperSymbol);
      if (asset) supportedAssets.push(asset);
    } else {
      unsupported.push(symbol);
    }
  });
  
  return { supported, unsupported, supportedAssets };
}

// Color scheme for assets (expanded from existing)
export const ASSET_COLORS: Record<string, string> = {
  BTC: '#f7931a',
  ETH: '#3c3c3d', 
  USDT: '#26a17b',
  BNB: '#f3ba2f',
  SOL: '#00ffa3',
  USDC: '#2775ca',
  XRP: '#23292f',
  DOGE: '#c2a633',
  ADA: '#0033ad',
  AVAX: '#e84142',
  SHIB: '#ffa409',
  DOT: '#e6007a',
  LINK: '#2a5ada',
  TRX: '#ff0013',
  MATIC: '#8247e5',
  ICP: '#29abe2',
  UNI: '#ff007a',
  LTC: '#bfbbbb',
  ATOM: '#2e3148',
  SUI: '#6fbcf0',
  // Fiat currency colors
  USD: '#16a34a',
  EUR: '#3b82f6',
  RON: '#dc2626',
};

export function getAssetColor(symbol: string): string {
  return ASSET_COLORS[symbol.toUpperCase()] || '#9aa3b2';
}

// Icon URL generators with fallbacks
export function getAssetIconUrl(symbol: string, size: number = 32): string[] {
  const sym = symbol.toLowerCase();
  return [
    // Primary: CoinGecko (more reliable)
    `https://assets.coingecko.com/coins/images/${getCoinGeckoId(symbol)}/small/small.png`,
    // Fallback 1: Alternative CoinGecko CDN
    `https://coin-images.coingecko.com/coins/images/${getCoinGeckoId(symbol)}/small/${sym}.png`,
    // Fallback 2: Original cryptoicons (if it comes back online)
    `https://cryptoicons.org/api/icon/${sym}/${size}`,
  ];
}

// Map crypto symbols to CoinGecko IDs
function getCoinGeckoId(symbol: string): string {
  const coinGeckoMap: Record<string, string> = {
    'BTC': '1',
    'ETH': '279',
    'USDT': '825',
    'BNB': '1839',
    'SOL': '4128',
    'USDC': '3408',
    'XRP': '44',
    'DOGE': '5',
    'ADA': '4943',
    'AVAX': '12559',
    'SHIB': '11939',
    'DOT': '12171',
    'LINK': '1975',
    'TRX': '1958',
    'MATIC': '4713',
    'ICP': '8916',
    'UNI': '7083',
    'LTC': '2',
    'ATOM': '3794',
    'SUI': '26375',
  };
  
  return coinGeckoMap[symbol.toUpperCase()] || symbol.toLowerCase();
}

// Fiat currency conversion rates (base: USD)
export const FIAT_RATES: Record<string, number> = {
  USD: 1.0,
  EUR: 1.08, // Approximate EUR/USD rate (1 EUR = 1.08 USD)
  RON: 4.5,  // Approximate RON/USD rate
};

// Re-export the real exchange rate service
export { getHistoricalExchangeRateSync as getHistoricalExchangeRate, preloadExchangeRates } from './exchange-rates';

// Convert between fiat currencies
export function convertFiat(amount: number, fromCurrency: string, toCurrency: string): number {
  if (fromCurrency === toCurrency) return amount;
  
  const fromRate = FIAT_RATES[fromCurrency.toUpperCase()] || 1;
  const toRate = FIAT_RATES[toCurrency.toUpperCase()] || 1;
  
  // Convert to USD first, then to target currency
  const usdAmount = amount / fromRate;
  return usdAmount * toRate;
}

// Get all supported fiat currencies
export function getFiatCurrencies(): string[] {
  // Only return EUR and USD, exclude RON
  return SUPPORTED_ASSETS
    .filter(asset => asset.category === 'fiat' && (asset.symbol === 'EUR' || asset.symbol === 'USD'))
    .map(asset => asset.symbol);
}

// Check if an asset is fiat
export function isFiatCurrency(symbol: string): boolean {
  const asset = getAssetBySymbol(symbol);
  return asset?.category === 'fiat';
}

// Check if an asset is a stablecoin
export function isStablecoin(symbol: string): boolean {
  const asset = getAssetBySymbol(symbol);
  return asset?.category === 'stablecoin';
}
