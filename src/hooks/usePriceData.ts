import { useMemo } from 'react';
import useSWR from 'swr';
import { jsonFetcher } from '@/lib/swr-fetcher';
import { fetchHistoricalWithLocalCache } from '@/lib/prices-cache';
import type { PricesResp, HistResp, PricePoint } from '@/lib/types';

interface UsePriceDataOptions {
  symbols: string[];
  dateRange?: { start: number; end: number };
  includeCurrentPrices?: boolean;
}

export function usePriceData({ symbols, dateRange, includeCurrentPrices = true }: UsePriceDataOptions) {
  // Get current prices
  const symbolsParam = symbols.join(',');
  const { data: currentPrices, isLoading: loadingCurrentPrices } = useSWR<PricesResp>(
    includeCurrentPrices && symbols.length ? `/api/prices/current?symbols=${encodeURIComponent(symbolsParam)}` : null, 
    jsonFetcher, 
    { revalidateOnFocus: false }
  );

  // Get historical prices
  const histKey = dateRange && symbols.length ? `hist:${JSON.stringify({ symbols, start: dateRange.start, end: dateRange.end })}` : null;
  const { data: hist, isLoading: loadingHist } = useSWR<HistResp>(
    histKey,
    async (key: string) => {
      const parsed = JSON.parse(key.slice(5)) as { symbols: string[]; start: number; end: number };
      return await fetchHistoricalWithLocalCache(parsed.symbols, parsed.start, parsed.end);
    }
  );

  // Get latest prices from historical data as fallback
  const latestPrices = useMemo((): Record<string, number> => {
    if (currentPrices?.prices && Object.keys(currentPrices.prices).length > 0) {
      return currentPrices.prices;
    }
    
    if (hist?.prices && hist.prices.length > 0) {
      const latest: Record<string, number> = {};
      const latestDates: Record<string, string> = {};
      
      hist.prices.forEach(p => {
        if (!latest[p.asset] || p.date > (latestDates[p.asset] || '')) {
          latest[p.asset] = p.price_usd;
          latestDates[p.asset] = p.date;
        }
      });
      
      return latest;
    }
    
    return {};
  }, [currentPrices, hist]);

  const isLoading = includeCurrentPrices ? loadingCurrentPrices : loadingHist;
  const hasData = Object.keys(latestPrices).length > 0;

  return {
    currentPrices: currentPrices?.prices || {},
    historicalPrices: hist?.prices || [],
    latestPrices,
    isLoading,
    hasData,
    loadingCurrentPrices,
    loadingHist
  };
}
