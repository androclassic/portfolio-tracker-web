import { useMemo } from 'react';
import { isStablecoin } from '@/lib/assets';

export interface PriceIndex {
  dates: string[];
  dateIndex: Record<string, number>;
  assetIndex: Record<string, number>;
  prices: number[][];
}

const EMPTY_INDEX: PriceIndex = { dates: [], dateIndex: {}, assetIndex: {}, prices: [] };

/**
 * Build a 2D price lookup table [assetIdx][dateIdx] from historical prices.
 */
export function usePriceIndex(
  historicalPrices: Array<{ asset: string; date: string; price_usd: number }>,
  assets: string[],
): PriceIndex {
  return useMemo(() => {
    if (historicalPrices.length === 0 || assets.length === 0) return EMPTY_INDEX;

    const dates = Array.from(new Set(historicalPrices.map(p => p.date))).sort();
    const dateIndex: Record<string, number> = {};
    for (let i = 0; i < dates.length; i++) dateIndex[dates[i]] = i;
    const assetIndex: Record<string, number> = {};
    for (let i = 0; i < assets.length; i++) assetIndex[assets[i]] = i;

    const prices: number[][] = new Array(assets.length);
    for (let ai = 0; ai < assets.length; ai++) {
      const asset = assets[ai]!;
      prices[ai] = new Array(dates.length).fill(0);
      if (isStablecoin(asset)) {
        for (let di = 0; di < dates.length; di++) prices[ai][di] = 1.0;
      } else {
        for (const p of historicalPrices) {
          const pAi = assetIndex[p.asset.toUpperCase()];
          const di = dateIndex[p.date];
          if (pAi === ai && di !== undefined) prices[ai][di] = p.price_usd;
        }
      }
    }

    return { dates, dateIndex, assetIndex, prices };
  }, [historicalPrices, assets]);
}
