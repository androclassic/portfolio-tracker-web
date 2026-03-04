'use client';
import { createContext, useContext, useMemo, useState, useEffect, ReactNode, useRef, useCallback } from 'react';
import useSWR from 'swr';
import { usePortfolio } from './PortfolioProvider';
import { jsonFetcher } from '@/lib/swr-fetcher';
import { usePriceData } from '@/hooks/usePriceData';
import { usePnLCalculation } from '@/hooks/usePnLCalculation';
import { useDailyPositions } from '@/hooks/useDailyPositions';
import { usePriceIndex, type PriceIndex } from '@/hooks/usePriceIndex';
import { useStackedComposition, type StackedData } from '@/hooks/useStackedComposition';
import { isStablecoin, getFiatCurrencies, getHistoricalExchangeRate, preloadExchangeRates } from '@/lib/assets';
import { computeNetHoldings } from '@/lib/portfolio-engine';
import type { Transaction as Tx } from '@/lib/types';

interface DashboardData {
  txs: Tx[] | undefined;
  loadingTxs: boolean;
  assets: string[];
  holdings: Record<string, number>;
  dailyPos: Array<{ date: string; asset: string; position: number }>;
  notesByDayAsset: Map<string, string>;
  priceIndex: PriceIndex;
  fxRateMap: Map<string, Record<string, number>>;
  latestPrices: Record<string, number>;
  latestPricesWithStables: Record<string, number>;
  historicalPrices: Array<{ asset: string; date: string; price_usd: number }>;
  loadingCurr: boolean;
  loadingHist: boolean;
  pnlData: ReturnType<typeof usePnLCalculation>;
  stacked: StackedData;
}

const DashboardDataContext = createContext<DashboardData | null>(null);

export function useDashboardData() {
  const ctx = useContext(DashboardDataContext);
  if (!ctx) throw new Error('useDashboardData must be used within DashboardDataProvider');
  return ctx;
}

export default function DashboardDataProvider({ children }: { children: ReactNode }) {
  // 1. Fetch transactions
  const { selectedId } = usePortfolio();
  const listKey = selectedId === 'all' ? '/api/transactions' : (selectedId ? `/api/transactions?portfolioId=${selectedId}` : null);
  const { data: txs, mutate, isLoading: loadingTxs } = useSWR<Tx[]>(listKey, jsonFetcher);

  // 2. Derive assets + date range
  const assets = useMemo(() => {
    const s = new Set<string>();
    (txs || []).forEach(t => {
      if (t.fromAsset) { const a = t.fromAsset.toUpperCase(); if (a !== 'USD') s.add(a); }
      if (t.toAsset) { const a = t.toAsset.toUpperCase(); if (a !== 'USD') s.add(a); }
    });
    return Array.from(s).sort();
  }, [txs]);

  const dateRange = useMemo(() => {
    if (!txs || txs.length === 0) return undefined;
    const dts = txs.map(t => new Date(t.datetime).getTime());
    return { start: Math.floor(Math.min(...dts) / 1000), end: Math.floor(Date.now() / 1000) };
  }, [txs]);

  // 3. Fetch prices
  const nonStableAssets = useMemo(() => assets.filter(a => !isStablecoin(a)), [assets]);
  const stableAssets = useMemo(() => assets.filter(a => isStablecoin(a)), [assets]);
  const { latestPrices, historicalPrices, isLoading: loadingCurr, loadingHist } = usePriceData({
    symbols: [...nonStableAssets, 'BTC'],
    dateRange,
    includeCurrentPrices: true,
  });

  // EUR/USD rate for EURC pricing
  const [eurUsdRate, setEurUsdRate] = useState<number | null>(null);

  const latestPricesWithStables = useMemo(() => {
    const result = { ...latestPrices };
    for (const stable of stableAssets) {
      if (stable === 'EURC' && eurUsdRate !== null) {
        result[stable] = eurUsdRate;
      } else {
        result[stable] = 1.0;
      }
    }
    return result;
  }, [latestPrices, stableAssets, eurUsdRate]);

  // 4. Compute holdings
  const holdings = useMemo(() => {
    return Object.fromEntries(
      Object.entries(computeNetHoldings(txs || [])).filter(([asset]) => asset !== 'USD')
    );
  }, [txs]);

  // 5. Compute daily positions + notes (extracted hook)
  const { dailyPos, notesByDayAsset } = useDailyPositions(txs);

  // 6. Build price index (extracted hook)
  const priceIndex = usePriceIndex(historicalPrices, assets);

  // 7. Compute stacked composition (extracted hook)
  const stacked = useStackedComposition(txs, assets, dailyPos, historicalPrices, latestPricesWithStables);

  // 8. Calculate P&L
  const pnlData = usePnLCalculation(txs, latestPricesWithStables, historicalPrices);

  // 9. Load FX rates in background
  const [fxRateMap, setFxRateMap] = useState<Map<string, Record<string, number>>>(new Map());
  const fxRatesLoadedKeyRef = useRef('');
  const priceIndexDatesKey = useMemo(() => priceIndex.dates.join(','), [priceIndex.dates]);

  // Extract EUR/USD rate when fxRateMap loads
  useEffect(() => {
    if (fxRateMap.size > 0) {
      const dates = Array.from(fxRateMap.keys()).sort().reverse();
      for (const d of dates) {
        const rates = fxRateMap.get(d);
        if (rates && rates['EUR']) { setEurUsdRate(rates['EUR']); return; }
      }
    }
    if (eurUsdRate === null && stableAssets.includes('EURC')) {
      setEurUsdRate(1.08); // Fallback
    }
  }, [fxRateMap, stableAssets, eurUsdRate]);

  // Background FX rate loader
  useEffect(() => {
    const dates = priceIndex.dates;
    if (!dates.length) { setFxRateMap(new Map()); return; }
    if (fxRatesLoadedKeyRef.current === priceIndexDatesKey && fxRateMap.size > 0) return;
    fxRatesLoadedKeyRef.current = priceIndexDatesKey;

    let cancelled = false;
    const run = async () => {
      setFxRateMap(new Map());
      const start = dates[0];
      const end = dates[dates.length - 1];
      try { await preloadExchangeRates(start, end); } catch { /* fallback */ }
      if (cancelled) return;

      const fiat = getFiatCurrencies();
      const map = new Map<string, Record<string, number>>();
      for (const d of dates) {
        const rec: Record<string, number> = {};
        for (const c of fiat) {
          try { rec[c] = getHistoricalExchangeRate(c, 'USD', d); }
          catch { rec[c] = c === 'USD' ? 1.0 : 0; }
        }
        map.set(d, rec);
      }
      if (!cancelled) setFxRateMap(map);
    };
    run().catch(() => { /* silently fail */ });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fxRateMap is the setter target
  }, [priceIndexDatesKey, priceIndex.dates]);

  // 10. Listen for transaction changes
  const handleTransactionChange = useCallback(() => {
    if (listKey) mutate();
  }, [listKey, mutate]);

  useEffect(() => {
    window.addEventListener('transactions-changed', handleTransactionChange);
    return () => window.removeEventListener('transactions-changed', handleTransactionChange);
  }, [handleTransactionChange]);

  // Assemble context value
  const value: DashboardData = useMemo(() => ({
    txs,
    loadingTxs,
    assets,
    holdings,
    dailyPos,
    notesByDayAsset,
    priceIndex,
    fxRateMap,
    latestPrices,
    latestPricesWithStables,
    historicalPrices,
    loadingCurr,
    loadingHist,
    pnlData,
    stacked,
  }), [txs, loadingTxs, assets, holdings, dailyPos, notesByDayAsset, priceIndex, fxRateMap, latestPrices, latestPricesWithStables, historicalPrices, loadingCurr, loadingHist, pnlData, stacked]);

  return (
    <DashboardDataContext.Provider value={value}>
      {children}
    </DashboardDataContext.Provider>
  );
}
