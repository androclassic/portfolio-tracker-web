import { useMemo } from 'react';
import { isStablecoin } from '@/lib/assets';
import type { Transaction as Tx } from '@/lib/types';
import type { DailyPosition } from './useDailyPositions';

export interface StackedData {
  dates: string[];
  totals: number[];
  perAssetUsd: Map<string, number[]>;
  perAssetUnits: Map<string, number[]>;
}

const EMPTY: StackedData = {
  dates: [],
  totals: [],
  perAssetUsd: new Map(),
  perAssetUnits: new Map(),
};

interface TxLike {
  type: string;
  datetime: string | Date;
  fromAsset?: string | null;
  fromQuantity?: number | null;
  toAsset: string;
  toQuantity: number;
}

export function computeStackedComposition(
  txs: TxLike[] | undefined,
  assets: string[],
  dailyPos: DailyPosition[],
  historicalPrices: Array<{ asset: string; date: string; price_usd: number }>,
  latestPricesWithStables: Record<string, number>,
): StackedData {
  if (!historicalPrices.length || !assets.length || !txs) return EMPTY;

  const EPS = 1e-9;
  const priceMap = new Map<string, number>();
  for (const p of historicalPrices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);

  const posMap = new Map<string, number>();
  if (dailyPos.length > 0) {
    for (const p of dailyPos) posMap.set(p.date + '|' + p.asset.toUpperCase(), p.position);
  } else {
    const dates = Array.from(new Set(historicalPrices.map(p => p.date))).sort();
    const cumulativeHoldings: Record<string, number> = {};
    const sortedTxs = [...txs].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
    let txIndex = 0;

    for (const date of dates) {
      while (txIndex < sortedTxs.length) {
        const tx = sortedTxs[txIndex]!;
        const txDate = new Date(tx.datetime).toISOString().slice(0, 10);
        if (txDate > date) break;

        if (tx.type === 'Swap') {
          if (tx.fromAsset && tx.fromAsset.toUpperCase() !== 'USD')
            cumulativeHoldings[tx.fromAsset.toUpperCase()] = (cumulativeHoldings[tx.fromAsset.toUpperCase()] || 0) - (tx.fromQuantity || 0);
          if (tx.toAsset && tx.toAsset.toUpperCase() !== 'USD')
            cumulativeHoldings[tx.toAsset.toUpperCase()] = (cumulativeHoldings[tx.toAsset.toUpperCase()] || 0) + tx.toQuantity;
        } else if (tx.type === 'Deposit' && tx.toAsset && tx.toAsset.toUpperCase() !== 'USD') {
          cumulativeHoldings[tx.toAsset.toUpperCase()] = (cumulativeHoldings[tx.toAsset.toUpperCase()] || 0) + tx.toQuantity;
        } else if (tx.type === 'Withdrawal' && tx.fromAsset && tx.fromAsset.toUpperCase() !== 'USD') {
          cumulativeHoldings[tx.fromAsset.toUpperCase()] = (cumulativeHoldings[tx.fromAsset.toUpperCase()] || 0) - (tx.fromQuantity || 0);
        }
        txIndex++;
      }

      for (const [asset, qty] of Object.entries(cumulativeHoldings)) {
        if (qty > 0) posMap.set(date + '|' + asset, qty);
      }
    }
  }

  const dates = Array.from(new Set(historicalPrices.map(p => p.date))).sort();
  const totals: number[] = new Array(dates.length).fill(0);
  const perAssetUsd = new Map<string, number[]>();
  const perAssetUnits = new Map<string, number[]>();

  for (const a of assets) {
    const y: number[] = new Array(dates.length).fill(0);
    const units: number[] = new Array(dates.length).fill(0);
    let lastPos = 0;
    let lastPx: number | undefined = undefined;
    for (let di = 0; di < dates.length; di++) {
      const d = dates[di]!;
      const key = d + '|' + a;
      if (posMap.has(key)) lastPos = posMap.get(key)!;
      const price = priceMap.get(key);
      if (price !== undefined && price > 0) lastPx = price;
      const px = isStablecoin(a)
        ? 1.0
        : ((price !== undefined && price > 0)
          ? price
          : (lastPx ?? (latestPricesWithStables[a] ?? 0)));
      const pos = Math.max(lastPos, 0);
      const val = px > 0 ? px * pos : 0;
      const v = val > EPS ? val : 0;
      y[di] = v;
      units[di] = pos;
      totals[di] += v;
    }
    perAssetUsd.set(a, y);
    perAssetUnits.set(a, units);
  }

  return { dates, totals, perAssetUsd, perAssetUnits };
}

/**
 * Compute stacked portfolio composition over time (USD values + units per asset per date).
 */
export function useStackedComposition(
  txs: Tx[] | undefined,
  assets: string[],
  dailyPos: DailyPosition[],
  historicalPrices: Array<{ asset: string; date: string; price_usd: number }>,
  latestPricesWithStables: Record<string, number>,
): StackedData {
  return useMemo(
    () => computeStackedComposition(txs, assets, dailyPos, historicalPrices, latestPricesWithStables),
    [txs, assets, dailyPos, historicalPrices, latestPricesWithStables],
  );
}
