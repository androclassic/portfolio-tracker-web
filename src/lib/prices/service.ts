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

  for (const provider of providers) {
    try {
      const res = await provider.getCurrentPrices(symbols);
      if (Object.keys(res).length) {
        currentPricesCache.set(key, res);
        return res;
      }
    } catch {
      // try next provider
    }
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

  for (const provider of providers) {
    try {
      const res = await provider.getHistoricalPrices(symbols, startUnixSec, endUnixSec);
      if (res.length) {
        historicalPricesCache.set(key, res);
        return res;
      }
    } catch {
      // try next provider
    }
  }
  return [];
}


