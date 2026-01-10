'use client';
import { createContext, useContext, useMemo, useState, useEffect, ReactNode, useRef } from 'react';
import useSWR from 'swr';
import { usePortfolio } from './PortfolioProvider';
import { jsonFetcher } from '@/lib/swr-fetcher';
import { usePriceData } from '@/hooks/usePriceData';
import { usePnLCalculation } from '@/hooks/usePnLCalculation';
import { isStablecoin, getFiatCurrencies, getHistoricalExchangeRate, preloadExchangeRates } from '@/lib/assets';
import type { Transaction as Tx } from '@/lib/types';

interface DashboardData {
  // Raw data
  txs: Tx[] | undefined;
  loadingTxs: boolean;
  assets: string[];
  holdings: Record<string, number>;
  dailyPos: Array<{ date: string; asset: string; position: number }>;
  notesByDayAsset: Map<string, string>;
  priceIndex: {
    dates: string[];
    dateIndex: Record<string, number>;
    assetIndex: Record<string, number>;
    prices: number[][];
  };
  fxRateMap: Map<string, Record<string, number>>;
  latestPrices: Record<string, number>;
  latestPricesWithStables: Record<string, number>;
  historicalPrices: Array<{ asset: string; date: string; price_usd: number }>;
  loadingCurr: boolean;
  loadingHist: boolean;
  pnlData: ReturnType<typeof usePnLCalculation>;
  stacked: {
    dates: string[];
    totals: number[];
    perAssetUsd: Map<string, number[]>;
  };
}

// Simple module-level cache: portfolioKey -> { txIds: string, data: DashboardData }
const cache = new Map<string, { txIds: string; data: DashboardData }>();

// Helper to create cache key from transaction IDs
function getCacheKey(txs: Tx[] | undefined): string {
  if (!txs || txs.length === 0) return 'empty';
  return txs.map(t => t.id).sort((a, b) => a - b).join(',');
}

const DashboardDataContext = createContext<DashboardData | null>(null);

export function useDashboardData() {
  const ctx = useContext(DashboardDataContext);
  if (!ctx) {
    throw new Error('useDashboardData must be used within DashboardDataProvider');
  }
  return ctx;
}

export default function DashboardDataProvider({ children }: { children: ReactNode }) {
  const { selectedId } = usePortfolio();
  const listKey = selectedId === 'all' ? '/api/transactions' : (selectedId ? `/api/transactions?portfolioId=${selectedId}` : null);
  const { data: txs, mutate, isLoading: loadingTxs } = useSWR<Tx[]>(listKey, jsonFetcher);
  
  const portfolioKey = listKey || 'all';
  const cacheKey = getCacheKey(txs);
  
  // Use ref to store computed data - doesn't trigger re-renders
  const computedDataRef = useRef<DashboardData | null>(null);
  const [computedData, setComputedData] = useState<DashboardData | null>(null);
  
  // Cache check will be done inside useEffect
  
  // Compute assets list (lightweight, always compute)
  const assets = useMemo(() => {
    const s = new Set<string>();
    (txs || []).forEach(t => {
      if (t.fromAsset) {
        const a = t.fromAsset.toUpperCase();
        if (a !== 'USD') s.add(a);
      }
      if (t.toAsset) {
        const a = t.toAsset.toUpperCase();
        if (a !== 'USD') s.add(a);
      }
    });
    return Array.from(s).sort();
  }, [txs]);

  // Compute date range
  const dateRange = useMemo(() => {
    if (!txs || txs.length === 0) return null as null | { start: number; end: number };
    const dts = txs.map(t => new Date(t.datetime).getTime());
    const minMs = Math.min(...dts);
    const txMinSec = Math.floor(minMs / 1000);
    const nowSec = Math.floor(Date.now() / 1000);
    return { start: txMinSec, end: nowSec };
  }, [txs]);

  // Get price data
  const nonStableAssets = useMemo(() => assets.filter(a => !isStablecoin(a)), [assets]);
  const stableAssets = useMemo(() => assets.filter(a => isStablecoin(a)), [assets]);
  const { latestPrices, historicalPrices, isLoading: loadingCurr, loadingHist } = usePriceData({
    symbols: [...nonStableAssets, 'BTC'],
    dateRange: dateRange || undefined,
    includeCurrentPrices: true
  });
  
  // Include historicalPrices length in cache key to invalidate when prices load
  const historicalPricesKey = useMemo(() => `${cacheKey}|prices:${historicalPrices.length}`, [cacheKey, historicalPrices.length]);

  // Calculate P&L (must be called unconditionally)
  const pnlData = usePnLCalculation(txs, latestPrices, historicalPrices);

  // Add stablecoins to latestPrices
  const latestPricesStr = useMemo(() => JSON.stringify(latestPrices), [latestPrices]);
  const latestPricesWithStables = useMemo(() => {
    const result = { ...latestPrices };
    for (const stable of stableAssets) {
      result[stable] = 1.0;
    }
    return result;
  }, [latestPrices, stableAssets]);

  // Compute expensive data in a deferred way
  useEffect(() => {
    // Check cache first - if valid, use it immediately
    // Include historicalPrices length in cache validation to ensure we recompute when prices load
    const cached = cache.get(portfolioKey);
    const isCacheValid = cached && cached.txIds === historicalPricesKey;
    
    if (isCacheValid && cached) {
      computedDataRef.current = cached.data;
      setComputedData(cached.data);
      return;
    }

    // Don't compute if we're still loading critical data (transactions)
    // But allow computation if we have transactions even if prices are still loading
    // This prevents the dashboard from getting stuck, but ensures we have data to work with
    if (loadingTxs && !txs) {
      console.log('[Dashboard] Waiting for transactions...');
      return; // Wait for transactions
    }

    // Wait for historical prices if they're still loading and we don't have any yet
    // This ensures stacked chart and other price-dependent computations have data
    if (loadingHist && historicalPrices.length === 0) {
      console.log('[Dashboard] Waiting for historical prices...');
      return; // Wait for historical prices
    }

    // Log when historicalPrices changes
    console.log(`[Dashboard] useEffect triggered: historicalPrices.length=${historicalPrices.length}, loadingHist=${loadingHist}, loadingTxs=${loadingTxs}, cacheKey=${cacheKey}`);

    // Compute even if loadingTxs is true - we can work with empty/partial data
    // This prevents the dashboard from getting stuck in a loading state
    // Computation is fast (5ms for 793 transactions), so no need to defer
    const computeStart = performance.now();
    console.log(`[Performance] 🔄 Starting dashboard computation: txs=${txs?.length || 0}, historicalPrices=${historicalPrices.length}, assets=${assets.length}, loadingHist=${loadingHist}`);
    
    // Compute holdings
    const holdings: Record<string, number> = {};
      if (txs) {
        for (const t of txs) {
          if (t.type === 'Swap') {
            if (t.toAsset) {
              const toA = t.toAsset.toUpperCase();
              if (toA !== 'USD') {
                holdings[toA] = (holdings[toA] || 0) + Math.abs(t.toQuantity);
              }
            }
            if (t.fromAsset) {
              const fromA = t.fromAsset.toUpperCase();
              if (fromA !== 'USD') {
                holdings[fromA] = (holdings[fromA] || 0) - Math.abs(t.fromQuantity || 0);
              }
            }
          } else if (t.type === 'Deposit') {
            const a = t.toAsset.toUpperCase();
            if (a !== 'USD') {
              holdings[a] = (holdings[a] || 0) + Math.abs(t.toQuantity);
            }
          } else if (t.type === 'Withdrawal') {
            const a = t.fromAsset?.toUpperCase();
            if (a && a !== 'USD') {
              holdings[a] = (holdings[a] || 0) - Math.abs(t.fromQuantity || 0);
            }
          }
        }
      }

    // Compute daily positions
    const dailyPos: Array<{ date: string; asset: string; position: number }> = [];
    if (txs && txs.length > 0) {
      console.log(`[Dashboard] Computing dailyPos from ${txs.length} transactions`);
        const rows: Array<{ asset: string; day: string; signed: number }> = [];
        for (const t of txs) {
          const day = new Date(t.datetime).toISOString().slice(0, 10);
          if (t.type === 'Swap') {
            if (t.toAsset) {
              const toA = t.toAsset.toUpperCase();
              if (toA !== 'USD') {
                rows.push({ asset: toA, day, signed: Math.abs(t.toQuantity) });
              }
            }
            if (t.fromAsset) {
              const fromA = t.fromAsset.toUpperCase();
              if (fromA !== 'USD') {
                rows.push({ asset: fromA, day, signed: -Math.abs(t.fromQuantity || 0) });
              }
            }
          } else if (t.type === 'Deposit') {
            const a = t.toAsset.toUpperCase();
            if (a !== 'USD') {
              rows.push({ asset: a, day, signed: Math.abs(t.toQuantity) });
            }
          } else if (t.type === 'Withdrawal') {
            const a = t.fromAsset?.toUpperCase();
            if (a && a !== 'USD') {
              rows.push({ asset: a, day, signed: -Math.abs(t.fromQuantity || 0) });
            }
          }
        }

        const byKey = new Map<string, number>();
        for (const r of rows) {
          const key = r.day + '|' + r.asset;
          byKey.set(key, (byKey.get(key) || 0) + r.signed);
        }

        const perAsset = new Map<string, { date: string; delta: number }[]>();
        for (const [key, delta] of byKey.entries()) {
          const [d, a] = key.split('|');
          if (!perAsset.has(a)) perAsset.set(a, []);
          perAsset.get(a)!.push({ date: d, delta });
        }

        for (const [asset, arr] of perAsset.entries()) {
          arr.sort((x, y) => x.date.localeCompare(y.date));
          let cum = 0;
          for (const it of arr) {
            cum += it.delta;
            dailyPos.push({ date: it.date, asset, position: cum });
          }
        }
      }
      console.log(`[Dashboard] Computed ${dailyPos.length} daily positions`);

      // Compute notes by day/asset
      const notesByDayAsset = new Map<string, string>();
      if (txs) {
        for (const t of txs) {
          const assets: string[] = [];
          if (t.fromAsset) assets.push(t.fromAsset.toUpperCase());
          if (t.toAsset) assets.push(t.toAsset.toUpperCase());
          const day = new Date(new Date(t.datetime).getFullYear(), new Date(t.datetime).getMonth(), new Date(t.datetime).getDate());
          const note = t.notes ? String(t.notes).trim() : '';
          if (!note) continue;
          for (const a of assets) {
            const key = day.toISOString().slice(0, 10) + '|' + a;
            const prev = notesByDayAsset.get(key);
            notesByDayAsset.set(key, prev ? `${prev}\n• ${note}` : `• ${note}`);
          }
        }
      }

      // Compute price index
      const hist = { prices: historicalPrices };
      console.log(`[Dashboard] hist.prices.length=${hist.prices.length}, historicalPrices.length=${historicalPrices.length}`);
      let priceIndex = {
        dates: [] as string[],
        dateIndex: {} as Record<string, number>,
        assetIndex: {} as Record<string, number>,
        prices: [] as number[][],
      };
      if (hist && hist.prices && assets.length > 0) {
        const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
        const dateIndex: Record<string, number> = {};
        for (let i = 0; i < dates.length; i++) dateIndex[dates[i]] = i;
        const assetIndex: Record<string, number> = {};
        for (let i = 0; i < assets.length; i++) assetIndex[assets[i]] = i;
        const prices: number[][] = new Array(assets.length);
        for (let ai = 0; ai < assets.length; ai++) {
          const asset = assets[ai]!;
          prices[ai] = new Array(dates.length).fill(0);
          if (isStablecoin(asset)) {
            for (let di = 0; di < dates.length; di++) {
              prices[ai][di] = 1.0;
            }
          } else {
            for (const p of hist.prices) {
              const pAi = assetIndex[p.asset.toUpperCase()];
              const di = dateIndex[p.date];
              if (pAi === ai && di !== undefined) {
                prices[ai][di] = p.price_usd;
              }
            }
          }
        }
        priceIndex = { dates, dateIndex, assetIndex, prices };
      }

      // Compute FX rate map (will be computed separately, start with empty)
      const fxRateMap = new Map<string, Record<string, number>>();

      // Compute stacked portfolio value
      let stacked = { dates: [] as string[], totals: [] as number[], perAssetUsd: new Map<string, number[]>() };
      // Compute if we have historical prices (dailyPos is preferred but we can compute from transactions if needed)
      const canComputeStacked = hist && hist.prices && hist.prices.length > 0 && assets.length > 0 && txs;
      console.log(`[Stacked] Condition check: hist=${!!hist}, hist.prices=${!!hist?.prices}, hist.prices.length=${hist?.prices?.length || 0}, assets.length=${assets.length}, txs=${!!txs}, txs.length=${txs?.length || 0}, canCompute=${canComputeStacked}, loadingHist=${loadingHist}`);
      if (canComputeStacked) {
        console.log(`[Stacked] ✅ Computing with ${hist.prices.length} prices, ${dailyPos?.length || 0} daily positions, ${assets.length} assets, ${txs.length} transactions`);
        const EPS = 1e-9;
        const priceMap = new Map<string, number>();
        for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);
        
        // Build position map - prefer dailyPos, but fallback to computing from transactions
        const posMap = new Map<string, number>();
        if (dailyPos && dailyPos.length > 0) {
          for (const p of dailyPos) posMap.set(p.date + '|' + p.asset.toUpperCase(), p.position);
        } else {
          // Compute positions from transactions if dailyPos is not available
          console.log(`[Stacked] Computing positions from transactions (dailyPos not available)`);
          const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
          const cumulativeHoldings: Record<string, number> = {};
          
          // Process transactions once, sorted by date
          const sortedTxs = [...txs].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
          let txIndex = 0;
          
          for (const date of dates) {
            // Process all transactions up to this date
            while (txIndex < sortedTxs.length) {
              const tx = sortedTxs[txIndex]!;
              const txDate = new Date(tx.datetime).toISOString().slice(0, 10);
              if (txDate > date) break;
              
              if (tx.type === 'Swap') {
                if (tx.fromAsset && tx.fromAsset.toUpperCase() !== 'USD') {
                  cumulativeHoldings[tx.fromAsset.toUpperCase()] = (cumulativeHoldings[tx.fromAsset.toUpperCase()] || 0) - (tx.fromQuantity || 0);
                }
                if (tx.toAsset && tx.toAsset.toUpperCase() !== 'USD') {
                  cumulativeHoldings[tx.toAsset.toUpperCase()] = (cumulativeHoldings[tx.toAsset.toUpperCase()] || 0) + tx.toQuantity;
                }
              } else if (tx.type === 'Deposit' && tx.toAsset && tx.toAsset.toUpperCase() !== 'USD') {
                cumulativeHoldings[tx.toAsset.toUpperCase()] = (cumulativeHoldings[tx.toAsset.toUpperCase()] || 0) + tx.toQuantity;
              } else if (tx.type === 'Withdrawal' && tx.fromAsset && tx.fromAsset.toUpperCase() !== 'USD') {
                cumulativeHoldings[tx.fromAsset.toUpperCase()] = (cumulativeHoldings[tx.fromAsset.toUpperCase()] || 0) - (tx.fromQuantity || 0);
              }
              txIndex++;
            }
            
            // Store positions for this date
            for (const [asset, qty] of Object.entries(cumulativeHoldings)) {
              if (qty > 0) {
                posMap.set(date + '|' + asset, qty);
              }
            }
          }
        }

        const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
        const totals: number[] = new Array(dates.length).fill(0);
        const perAssetUsd = new Map<string, number[]>();

        for (const a of assets) {
          const y: number[] = new Array(dates.length).fill(0);
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
            totals[di] += v;
          }
          perAssetUsd.set(a, y);
        }
        stacked = { dates, totals, perAssetUsd };
        console.log(`[Stacked] ✅ Computed ${stacked.dates.length} dates, ${stacked.totals.length} totals, perAssetUsd.size=${perAssetUsd.size}`);
      } else {
        const reasons = [];
        if (!hist) reasons.push('no hist');
        if (!hist?.prices) reasons.push('no hist.prices');
        if (hist?.prices?.length === 0) reasons.push(`hist.prices.length=${hist?.prices?.length || 0}`);
        if (assets.length === 0) reasons.push(`assets.length=${assets.length}`);
        if (!txs) reasons.push('no txs');
        console.log(`[Stacked] ❌ Skipping: ${reasons.join(', ')}`);
      }

    const computed: DashboardData = {
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
    };

    // Store in cache
        cache.set(portfolioKey, { txIds: historicalPricesKey, data: computed });
    
    // Limit cache size
    if (cache.size > 10) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }

    computedDataRef.current = computed;
    
    const duration = performance.now() - computeStart;
    console.log(`[Performance] Dashboard computation: ${duration.toFixed(2)}ms (${txs?.length || 0} transactions)`);
    
    // Set state immediately to update UI
    setComputedData(computed);
  }, [txs, loadingTxs, assets, latestPrices, latestPricesWithStables, historicalPricesKey, loadingCurr, loadingHist, pnlData, portfolioKey, cacheKey]);

  // Compute FX rate map separately (async)
  const [fxRateMap, setFxRateMap] = useState<Map<string, Record<string, number>>>(new Map());
  const fxRatesLoadedKeyRef = useRef<string>(''); // Track which date range has been loaded
  const priceIndexDatesKey = useMemo(() => {
    const data = computedData || computedDataRef.current;
    return data?.priceIndex.dates.join(',') || '';
  }, [computedData]);
  
  // Load FX rates in background - don't block dashboard rendering
  useEffect(() => {
    if (!computedData) return;
    
    const dates = computedData.priceIndex.dates;
    if (!dates.length) {
      setFxRateMap(new Map());
      return;
    }
    
    // Prevent reloading if already loaded for the same date range
    if (fxRatesLoadedKeyRef.current === priceIndexDatesKey && fxRateMap.size > 0) {
      return; // Already loaded for this date range
    }
    
    // Mark as loading for this date range
    fxRatesLoadedKeyRef.current = priceIndexDatesKey;
    
    let cancelled = false;
    const run = async () => {
      // Initialize with empty map immediately so dashboard doesn't wait
      setFxRateMap(new Map());
      
      // Load FX rates in background (non-blocking)
      const fxStart = performance.now();
      console.log(`[Performance] 💱 Starting FX rates load: ${dates.length} dates`);
      const start = dates[0];
      const end = dates[dates.length - 1];
      try {
        await preloadExchangeRates(start, end);
        const fxPreloadEnd = performance.now();
        const fxPreloadDuration = fxPreloadEnd - fxStart;
        console.log(`[Performance] 💱 FX rates preload completed in ${fxPreloadDuration.toFixed(2)}ms (${(fxPreloadDuration / 1000).toFixed(2)}s)`);
      } catch (e) {
        console.warn('Failed to preload FX for dashboard:', e);
        // Continue anyway - we'll use fallback rates
      }
      if (cancelled) return;
      
      const mapBuildStart = performance.now();
      const fiat = getFiatCurrencies();
      const map = new Map<string, Record<string, number>>();
      for (const d of dates) {
        const rec: Record<string, number> = {};
        for (const c of fiat) {
          try {
            rec[c] = getHistoricalExchangeRate(c, 'USD', d);
          } catch {
            // Use fallback rates if FX data unavailable
            rec[c] = c === 'USD' ? 1.0 : 0;
          }
        }
        map.set(d, rec);
      }
      const mapBuildEnd = performance.now();
      if (!cancelled) {
        const fxEnd = performance.now();
        const fxTotalDuration = fxEnd - fxStart;
        const mapBuildDuration = mapBuildEnd - mapBuildStart;
        console.log(`[Performance] 💱 FX rates: total load time ${fxTotalDuration.toFixed(2)}ms (${(fxTotalDuration / 1000).toFixed(2)}s) - map build: ${mapBuildDuration.toFixed(2)}ms, ${map.size} dates`);
        setFxRateMap(map);
        // Update computed data with FX map (but don't trigger re-render by updating state)
        if (computedDataRef.current) {
          computedDataRef.current.fxRateMap = map;
        }
      }
    };
    // Run in background - don't block
    run().catch(err => {
      console.warn('FX rate loading error (non-blocking):', err);
    });
    return () => {
      cancelled = true;
    };
  }, [priceIndexDatesKey, computedData]);

  // Listen for transaction changes
  useEffect(() => {
    const handleTransactionChange = () => {
      if (listKey) {
        mutate();
        // Clear cache for this portfolio
        cache.delete(portfolioKey);
      }
    };
    window.addEventListener('transactions-changed', handleTransactionChange);
    return () => window.removeEventListener('transactions-changed', handleTransactionChange);
  }, [listKey, mutate, portfolioKey]);

  // Use computed data or fallback to loading state
  // Memoize to ensure updates trigger re-renders
  const value: DashboardData = useMemo(() => {
    const data = computedData || computedDataRef.current;
    if (data) {
      // Return computed data with latest loading states
      return {
        ...data,
        txs: txs ?? data.txs,
        loadingTxs,
        latestPrices: latestPrices ?? data.latestPrices,
        latestPricesWithStables: latestPricesWithStables ?? data.latestPricesWithStables,
        historicalPrices: historicalPrices ?? data.historicalPrices,
        loadingCurr,
        loadingHist,
        pnlData: pnlData ?? data.pnlData,
      };
    }
    // Return loading state
    return {
      txs,
      loadingTxs,
      assets,
      holdings: {},
      dailyPos: [],
      notesByDayAsset: new Map(),
      priceIndex: { dates: [], dateIndex: {}, assetIndex: {}, prices: [] },
      fxRateMap: new Map(),
      latestPrices,
      latestPricesWithStables,
      historicalPrices,
      loadingCurr,
      loadingHist,
      pnlData,
      stacked: { dates: [], totals: [], perAssetUsd: new Map() },
    };
  }, [computedData, txs, loadingTxs, assets, latestPrices, latestPricesWithStables, historicalPrices, loadingCurr, loadingHist, pnlData]);

  return (
    <DashboardDataContext.Provider value={value}>
      {children}
    </DashboardDataContext.Provider>
  );
}
