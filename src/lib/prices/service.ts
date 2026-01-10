import { DEFAULT_PROVIDERS, PriceProvider, CurrentPrices, HistoricalPoint } from './providers';
import { TtlCache } from '../cache';
import { prisma } from '@/lib/prisma';

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

/**
 * Get historical prices from database cache
 * Returns all available cached data for the requested range
 */
async function getHistoricalPricesFromDB(
  symbols: string[],
  startUnixSec: number,
  endUnixSec: number
): Promise<HistoricalPoint[]> {
  try {
    const startDate = new Date(startUnixSec * 1000).toISOString().slice(0, 10);
    const endDate = new Date(endUnixSec * 1000).toISOString().slice(0, 10);
    
    // Query database for any cached prices in the range
    // Don't check updatedAt - historical prices don't change
    const cached = await prisma.historicalPrice.findMany({
      where: {
        asset: { in: symbols.map(s => s.toUpperCase()) },
        date: { gte: startDate, lte: endDate },
      },
      orderBy: [{ date: 'asc' }, { asset: 'asc' }],
    });

    if (cached.length > 0) {
      return cached.map(p => ({
        date: p.date,
        asset: p.asset,
        price_usd: p.price_usd,
      }));
    }
  } catch (error) {
    console.warn('[Price Service] Error reading from DB cache:', error);
  }
  return [];
}

/**
 * Store historical prices in database cache
 * Uses upsert to handle both new and existing records
 */
async function storeHistoricalPricesInDB(prices: HistoricalPoint[]): Promise<void> {
  if (prices.length === 0) return;
  
  try {
    // Batch upserts for efficiency
    const chunkSize = 100;
    for (let i = 0; i < prices.length; i += chunkSize) {
      const chunk = prices.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(p =>
          prisma.historicalPrice.upsert({
            where: {
              asset_date: {
                asset: p.asset.toUpperCase(),
                date: p.date,
              },
            },
            update: {
              price_usd: p.price_usd,
              updatedAt: new Date(),
            },
            create: {
              asset: p.asset.toUpperCase(),
              date: p.date,
              price_usd: p.price_usd,
            },
          })
        )
      );
    }
  } catch (error) {
    console.warn('[Price Service] Error storing in DB cache:', error);
  }
}

/**
 * Generate stablecoin historical data (always $1.00)
 */
function generateStablecoinData(
  symbols: string[],
  startUnixSec: number,
  endUnixSec: number
): HistoricalPoint[] {
  const stablecoins = ['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FRAX'];
  const stablecoinSymbols = symbols.filter(s => stablecoins.includes(s.toUpperCase()));
  if (stablecoinSymbols.length === 0) return [];

  const data: HistoricalPoint[] = [];
  const startDate = new Date(startUnixSec * 1000);
  startDate.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(endUnixSec * 1000);
  endDate.setUTCHours(0, 0, 0, 0);
  
  for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    for (const symbol of stablecoinSymbols) {
      data.push({
        date: dateStr,
        asset: symbol.toUpperCase(),
        price_usd: 1.00
      });
    }
  }
  
  return data;
}

/**
 * Main function to get historical prices
 * Uses multi-tier caching: in-memory -> database -> external API
 */
export async function getHistoricalPrices(
  symbols: string[],
  startUnixSec: number,
  endUnixSec: number,
  providers: PriceProvider[] = DEFAULT_PROVIDERS
): Promise<HistoricalPoint[]> {
  if (symbols.length === 0) return [];

  // 1. Check in-memory cache first (fastest)
  const key = keyForHistorical(symbols, startUnixSec, endUnixSec, providers);
  const cached = historicalPricesCache.get(key);
  if (cached) return cached;

  // 2. Check database cache (persistent, fast)
  const dbCached = await getHistoricalPricesFromDB(symbols, startUnixSec, endUnixSec);
  
  // Generate stablecoin data
  const stablecoinData = generateStablecoinData(symbols, startUnixSec, endUnixSec);
  
  // Combine DB cache with stablecoin data
  const combinedFromCache = new Map<string, HistoricalPoint>();
  for (const p of [...dbCached, ...stablecoinData]) {
    const k = `${p.asset}|${p.date}`;
    combinedFromCache.set(k, p);
  }

  // Check if we have complete coverage
  const startDate = new Date(startUnixSec * 1000);
  startDate.setUTCHours(0, 0, 0, 0);
  const endDate = new Date(endUnixSec * 1000);
  endDate.setUTCHours(0, 0, 0, 0);
  
  const requestedDates = new Set<string>();
  for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
    requestedDates.add(d.toISOString().slice(0, 10));
  }

  // Check coverage for non-stablecoin assets
  const nonStableSymbols = symbols.filter(s => {
    const upper = s.toUpperCase();
    return !['USDT', 'USDC', 'DAI', 'BUSD', 'TUSD', 'FRAX'].includes(upper);
  });

  let needsFetch = false;
  if (nonStableSymbols.length > 0) {
    for (const sym of nonStableSymbols) {
      for (const date of requestedDates) {
        if (!combinedFromCache.has(`${sym.toUpperCase()}|${date}`)) {
          needsFetch = true;
          break;
        }
      }
      if (needsFetch) break;
    }
  }

  // If we have good coverage, return cached data
  if (!needsFetch && combinedFromCache.size > 0) {
    const result = Array.from(combinedFromCache.values());
    historicalPricesCache.set(key, result);
    return result;
  }

  // 3. Fetch missing data from external providers
  const fetchedData: HistoricalPoint[] = [];
  for (const provider of providers) {
    try {
      const res = await provider.getHistoricalPrices(nonStableSymbols, startUnixSec, endUnixSec);
      fetchedData.push(...res);
      if (fetchedData.length > 0) break; // Got data, stop trying providers
    } catch (error) {
      console.warn(`[Price Service] Provider ${provider.name} failed:`, error);
      // Continue to next provider
    }
  }

  // Merge: fetched data + stablecoin data + any existing cache
  const final = new Map<string, HistoricalPoint>();
  
  // Add fetched data (takes priority)
  for (const p of fetchedData) {
    final.set(`${p.asset}|${p.date}`, p);
  }
  
  // Add stablecoin data
  for (const p of stablecoinData) {
    final.set(`${p.asset}|${p.date}`, p);
  }
  
  // Add any remaining cached data we didn't fetch
  for (const [k, p] of combinedFromCache.entries()) {
    if (!final.has(k)) {
      final.set(k, p);
    }
  }

  const result = Array.from(final.values());

  // Store in caches
  if (result.length > 0) {
    historicalPricesCache.set(key, result);
    // Store in database (async, don't wait)
    storeHistoricalPricesInDB(fetchedData.length > 0 ? fetchedData : result).catch(err => {
      console.warn('[Price Service] Failed to store in DB:', err);
    });
  }

  return result;
}
