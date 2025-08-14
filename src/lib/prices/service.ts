import { DEFAULT_PROVIDERS, PriceProvider, CurrentPrices, HistoricalPoint } from './providers';
import { TtlCache } from '../cache';

const currentPricesCache = new TtlCache<string, CurrentPrices>(60_000); // 1 min
const historicalPricesCache = new TtlCache<string, HistoricalPoint[]>(5 * 60_000); // 5 min

function keyForCurrent(symbols: string[], providers: PriceProvider[]) {
  return `current:${providers.map((p) => p.name).join(',')}:${symbols.sort().join(',')}`;
}

function keyForHistorical(symbols: string[], start: number, end: number, providers: PriceProvider[]) {
  return `hist:${providers.map((p) => p.name).join(',')}:${symbols.sort().join(',')}:${start}:${end}`;
}

export async function getCurrentPrices(symbols: string[], providers: PriceProvider[] = DEFAULT_PROVIDERS): Promise<CurrentPrices> {
  const key = keyForCurrent(symbols, providers);
  const cached = currentPricesCache.get(key);
  if (cached) return cached;

  // Start with hardcoded stablecoin prices
  const stablecoins = ['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FRAX'];
  const result: CurrentPrices = {};
  
  // Add stablecoin prices (hardcoded to $1.00)
  for (const symbol of symbols) {
    if (stablecoins.includes(symbol.toUpperCase())) {
      result[symbol.toUpperCase()] = 1.00;
    }
  }

  for (const provider of providers) {
    try {
      const res = await provider.getCurrentPrices(symbols);
      // Merge provider results with hardcoded stablecoin prices
      Object.assign(result, res);
      if (Object.keys(result).length) {
        currentPricesCache.set(key, result);
        return result;
      }
    } catch {
      // try next provider
    }
  }
  
  // Return at least the stablecoin prices if providers fail
  if (Object.keys(result).length) {
    currentPricesCache.set(key, result);
    return result;
  }
  
  return {};
}

export async function getHistoricalPrices(
  symbols: string[],
  startUnixSec: number,
  endUnixSec: number,
  providers: PriceProvider[] = DEFAULT_PROVIDERS
): Promise<HistoricalPoint[]> {
  const key = keyForHistorical(symbols, startUnixSec, endUnixSec, providers);
  const cached = historicalPricesCache.get(key);
  if (cached) return cached;

  // Generate stablecoin historical data (hardcoded to $1.00)
  const stablecoins = ['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FRAX'];
  const stablecoinData: HistoricalPoint[] = [];
  
  const stablecoinSymbols = symbols.filter(s => stablecoins.includes(s.toUpperCase()));
  if (stablecoinSymbols.length > 0) {
    // Generate daily data points from start to end
    const startDate = new Date(startUnixSec * 1000);
    const endDate = new Date(endUnixSec * 1000);
    
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      for (const symbol of stablecoinSymbols) {
        stablecoinData.push({
          date: dateStr,
          asset: symbol.toUpperCase(),
          price_usd: 1.00
        });
      }
    }
  }

  for (const provider of providers) {
    try {
      const res = await provider.getHistoricalPrices(symbols, startUnixSec, endUnixSec);
      // Combine provider results with stablecoin data
      const combined = [...stablecoinData, ...res];
      if (combined.length) {
        historicalPricesCache.set(key, combined);
        return combined;
      }
    } catch {
      // try next provider
    }
  }
  
  // Return at least the stablecoin data if providers fail
  if (stablecoinData.length) {
    historicalPricesCache.set(key, stablecoinData);
    return stablecoinData;
  }
  
  return [];
}


