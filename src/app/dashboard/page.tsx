'use client';
import useSWR from 'swr';
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { usePortfolio } from '../PortfolioProvider';
import { getAssetColor, getFiatCurrencies, convertFiat, isFiatCurrency, isStablecoin, getHistoricalExchangeRate, preloadExchangeRates } from '@/lib/assets';
import { usePriceData } from '@/hooks/usePriceData';
import { usePnLCalculation } from '@/hooks/usePnLCalculation';
import AllocationPieChart from '@/components/AllocationPieChart';
import AuthGuard from '@/components/AuthGuard';
import { PlotlyChart as Plot } from '@/components/charts/plotly/PlotlyChart';
import { LineChart } from '@/components/charts/LineChart';
import { buildNetWorthLineChartModel } from '@/lib/chart-models/net-worth';
import { ChartCard } from '@/components/ChartCard';
import { sliceStartIndexForIsoDates } from '@/lib/timeframe';

import type { Layout, Data } from 'plotly.js';
import { jsonFetcher } from '@/lib/swr-fetcher';
import type { Transaction as Tx, PricesResp, HistResp } from '@/lib/types';
import { STABLECOINS } from '@/lib/types';
import { fetchHistoricalWithLocalCache } from '@/lib/prices-cache';

const fetcher = jsonFetcher;

// Types and historical fetcher moved to lib


export default function DashboardPage(){
  const { selectedId } = usePortfolio();
  const listKey = selectedId === 'all' ? '/api/transactions' : (selectedId? `/api/transactions?portfolioId=${selectedId}` : null);
  const { data: txs, mutate, isLoading: loadingTxs } = useSWR<Tx[]>(listKey, fetcher);
  const [selectedAsset, setSelectedAsset] = useState<string>('');
  const [selectedPnLAsset, setSelectedPnLAsset] = useState<string>('');
  const [selectedBtcChart, setSelectedBtcChart] = useState<string>('accumulation'); // 'ratio' | 'accumulation'
  const [selectedAltcoin, setSelectedAltcoin] = useState<string>('ALL');
  const [selectedProfitAsset, setSelectedProfitAsset] = useState<string>('ADA');
  const [selectedCostAsset, setSelectedCostAsset] = useState<string>('');
  const [heatmapTimeframe, setHeatmapTimeframe] = useState<string>('24h'); // 'current' | '24h' | '7d' | '30d'
  const [stackedMode, setStackedMode] = useState<'usd' | 'percent'>('usd');
  const [hiddenStackedAssets, setHiddenStackedAssets] = useState<Set<string>>(() => new Set());

  const assets = useMemo(()=>{
    const s = new Set<string>();
    (txs||[]).forEach(t=> {
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

  const colorFor = useCallback((asset: string): string => {
    return getAssetColor(asset);
  }, []);

  function withAlpha(hex: string, alpha: number): string {
    // hex like #rrggbb
    const h = hex.replace('#','');
    const r = parseInt(h.substring(0,2), 16);
    const g = parseInt(h.substring(2,4), 16);
    const b = parseInt(h.substring(4,6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // Convert assets array to string for stable comparison
  const assetsKey = useMemo(() => assets.join(','), [assets]);

  useEffect(()=>{
    if (assets.length && !selectedAsset) {
      setSelectedAsset(assets[0]);
    }
  }, [assetsKey, assets.length, selectedAsset]);

  useEffect(()=>{
    if (assets.length && !selectedPnLAsset) {
      setSelectedPnLAsset(assets[0]);
    }
  }, [assetsKey, assets.length, selectedPnLAsset]);

  useEffect(()=>{
    if (assets.length && !selectedCostAsset) {
      setSelectedCostAsset(assets[0]);
    }
  }, [assetsKey, assets.length, selectedCostAsset]);

  // Profit-taking chart should default to ADA, but gracefully fallback if ADA isn't present
  useEffect(() => {
    const nonBtcAssets = assets.filter(a => a !== 'BTC');
    if (!nonBtcAssets.length) return;

    if (!nonBtcAssets.includes(selectedProfitAsset)) {
      setSelectedProfitAsset(nonBtcAssets.includes('ADA') ? 'ADA' : nonBtcAssets[0]);
    }
  }, [assetsKey, selectedProfitAsset]);

  // Listen for transaction changes and refresh dashboard data
  useEffect(() => {
    const handleTransactionChange = () => {
      console.log('Transactions changed, refreshing dashboard data...');
      if (listKey) mutate();
    };

    window.addEventListener('transactions-changed', handleTransactionChange);
    return () => window.removeEventListener('transactions-changed', handleTransactionChange);
  }, [listKey, mutate]);

  const holdings = useMemo(()=>{
    const pos: Record<string, number> = {};
    if (!txs) return pos;
    for (const t of txs){
      if (t.type === 'Swap') {
        // For swaps: toAsset increases, fromAsset decreases
        if (t.toAsset) {
          const toA = t.toAsset.toUpperCase();
          if (toA !== 'USD') {
            pos[toA] = (pos[toA]||0) + Math.abs(t.toQuantity);
          }
        }
        if (t.fromAsset) {
          const fromA = t.fromAsset.toUpperCase();
          if (fromA !== 'USD') {
            pos[fromA] = (pos[fromA]||0) - Math.abs(t.fromQuantity || 0);
          }
        }
      } else if (t.type === 'Deposit') {
        // Deposit increases toAsset
        const a = t.toAsset.toUpperCase();
        if (a !== 'USD') {
          pos[a] = (pos[a]||0) + Math.abs(t.toQuantity);
        }
      } else if (t.type === 'Withdrawal') {
        // Withdrawal: remove stablecoin from holdings (fromAsset is the stablecoin)
        const a = t.fromAsset?.toUpperCase();
        if (a && a !== 'USD') {
          pos[a] = (pos[a]||0) - Math.abs(t.fromQuantity || 0);
        }
      }
    }
    return pos;
  }, [txs]);

  // historical prices for portfolio value stacked area
  const dateRange = useMemo(()=>{
    if (!txs || txs.length===0) return null as null | { start: number; end: number };
    const dts = txs.map(t=> new Date(t.datetime).getTime());
    const minMs = Math.min(...dts);
    const txMinSec = Math.floor(minMs / 1000);
    const nowSec = Math.floor(Date.now() / 1000);
    return { start: txMinSec, end: nowSec };
  }, [txs]);

  // Use shared price data hook - include stablecoins but they'll be priced at $1
  const nonStableAssets = useMemo(() => 
    assets.filter(a => !isStablecoin(a)),
    [assets]
  );
  const stableAssets = useMemo(() =>
    assets.filter(a => isStablecoin(a)),
    [assets]
  );
  const { latestPrices, historicalPrices, isLoading: loadingCurr } = usePriceData({
    symbols: [...nonStableAssets, 'BTC'], // Always include BTC for conversion, exclude stablecoins from API
    dateRange: dateRange || undefined,
    includeCurrentPrices: true
  });
  
  // Add stablecoins to latestPrices with $1.00 price
  const latestPricesWithStables = useMemo(() => {
    const result = { ...latestPrices };
    for (const stable of stableAssets) {
      result[stable] = 1.0;
    }
    return result;
  }, [latestPrices, stableAssets]);

  // Stablecoin balance (Dashboard treats stables as the "cash-like" component, not fiat).
  const stablecoinBalanceUsd = useMemo(() => {
    let total = 0;
    for (const [asset, units] of Object.entries(holdings)) {
      const sym = asset.toUpperCase();
      if (!isStablecoin(sym)) continue;
      const qty = Number(units) || 0;
      if (qty <= 0) continue;
      const px = latestPrices[sym] || 1; // stablecoins are hardcoded to ~$1 in price service
      total += qty * px;
    }
    return total;
  }, [holdings, latestPrices]);

  // daily positions time series (buy/sell only; use UTC day to align with historical price dates)
  const dailyPos = useMemo(()=>{
    if (!txs || txs.length===0) return [] as { date:string; asset:string; position:number }[];
    const rows: Array<{ asset: string; day: string; signed: number }> = [];
    
    for (const t of txs) {
      const day = new Date(t.datetime).toISOString().slice(0, 10); // UTC day key
      
      if (t.type === 'Swap') {
        // For swaps: toAsset increases (buy), fromAsset decreases (sell)
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
        // Withdrawal: remove stablecoin from holdings (fromAsset is the stablecoin)
        const a = t.fromAsset?.toUpperCase();
        if (a && a !== 'USD') {
          rows.push({ asset: a, day, signed: -Math.abs(t.fromQuantity || 0) });
        }
      }
    }
    // group by day and asset
    const byKey = new Map<string, number>();
    for (const r of rows){
      const key = r.day + '|' + r.asset;
      byKey.set(key, (byKey.get(key)||0) + r.signed);
    }
    // build per-asset sorted days, cumsum
    const perAsset = new Map<string, { date:string; delta:number }[]>();
    for (const [key, delta] of byKey.entries()){
      const [d, a] = key.split('|');
      if (!perAsset.has(a)) perAsset.set(a, []);
      perAsset.get(a)!.push({ date:d, delta });
    }
    const out: { date:string; asset:string; position:number }[] = [];
    for (const [asset, arr] of perAsset.entries()){
      arr.sort((x,y)=> x.date.localeCompare(y.date));
      let cum=0;
      for (const it of arr){ cum += it.delta; out.push({ date: it.date, asset, position: cum }); }
    }
    return out;
  }, [txs]);

  const notesByDayAsset = useMemo(()=>{
    const map = new Map<string, string>();
    if (!txs) return map;
    for (const t of txs){
      // Collect notes for all involved assets
      const assets: string[] = [];
      if (t.fromAsset) assets.push(t.fromAsset.toUpperCase());
      if (t.toAsset) assets.push(t.toAsset.toUpperCase());
      
      const day = new Date(new Date(t.datetime).getFullYear(), new Date(t.datetime).getMonth(), new Date(t.datetime).getDate());
      const note = t.notes ? String(t.notes).trim() : '';
      if (!note) continue;
      
      // Add note to each involved asset
      for (const a of assets) {
        const key = day.toISOString().slice(0,10) + '|' + a;
        const prev = map.get(key);
        map.set(key, prev ? `${prev}\n• ${note}` : `• ${note}`);
      }
    }
    return map;
  }, [txs]);

  // Historical data is now provided by usePriceData hook
  const hist = useMemo(() => ({ prices: historicalPrices }), [historicalPrices]);
  const loadingHist = false; // Historical data loading is handled by usePriceData

  // Shared price indices and matrices for fast lookups across charts
  const priceIndex = useMemo(() => {
    if (!hist || !hist.prices || assets.length === 0) {
      return {
        dates: [] as string[],
        dateIndex: {} as Record<string, number>,
        assetIndex: {} as Record<string, number>,
        prices: [] as number[][],
      };
    }
    const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
    const dateIndex: Record<string, number> = {};
    for (let i = 0; i < dates.length; i++) dateIndex[dates[i]] = i;
    const assetIndex: Record<string, number> = {};
    for (let i = 0; i < assets.length; i++) assetIndex[assets[i]] = i;
    const prices: number[][] = new Array(assets.length);
    for (let ai = 0; ai < assets.length; ai++) {
      const asset = assets[ai]!;
      prices[ai] = new Array(dates.length).fill(0);
      // For stablecoins, set price to $1.00 for all dates
      if (isStablecoin(asset)) {
        for (let di = 0; di < dates.length; di++) {
          prices[ai][di] = 1.0;
        }
      } else {
        // For other assets, use historical prices
        for (const p of hist.prices) {
          const pAi = assetIndex[p.asset.toUpperCase()];
          const di = dateIndex[p.date];
          if (pAi === ai && di !== undefined) {
            prices[ai][di] = p.price_usd;
          }
        }
      }
    }
    return { dates, dateIndex, assetIndex, prices };
  }, [hist, assets]);

  // Preload historical FX rates for the date range, then build a sync lookup map.
  // IMPORTANT: preloadExchangeRates is async; do NOT call sync FX getters before preload completes.
  const [fxRateMap, setFxRateMap] = useState<Map<string, Record<string, number>>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const dates = priceIndex.dates;
      if (!dates.length) {
        setFxRateMap(new Map());
        return;
      }
      const start = dates[0];
      const end = dates[dates.length - 1];
      try {
        await preloadExchangeRates(start, end);
      } catch (e) {
        // Don't crash dashboard; FX will show as 0 for missing dates/currencies.
        console.warn('Failed to preload FX for dashboard:', e);
      }
      if (cancelled) return;
      const fiat = getFiatCurrencies();
      const map = new Map<string, Record<string, number>>();
      for (const d of dates) {
        const rec: Record<string, number> = {};
        for (const c of fiat) {
          try {
            rec[c] = getHistoricalExchangeRate(c, 'USD', d);
          } catch {
            rec[c] = c === 'USD' ? 1.0 : 0;
          }
        }
        map.set(d, rec);
      }
      setFxRateMap(map);
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [priceIndex.dates]);

  // Calculate P&L using shared logic
  const pnlData = usePnLCalculation(txs, latestPrices, historicalPrices);

  // derive portfolio value over time stacked by asset (positive-only values)
  const stacked = useMemo(() => {
    if (!hist || !hist.prices || dailyPos.length === 0) {
      return { dates: [] as string[], totals: [] as number[], perAssetUsd: new Map<string, number[]>() };
    }
    const EPS = 1e-9;
    const priceMap = new Map<string, number>();
    for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);
    const posMap = new Map<string, number>();
    for (const p of dailyPos) posMap.set(p.date + '|' + p.asset.toUpperCase(), p.position);

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
        // If historical price is missing for an asset (common for illiquid tokens),
        // fall back to last known historical price, then latest price.
        // For stablecoins, always use $1.00
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
    return { dates, totals, perAssetUsd };
  }, [hist, dailyPos, assets, latestPrices]);

  const stackedTraces = useMemo(() => {
    const dates = stacked.dates;
    if (!dates.length) return { usd: [] as Data[], percent: [] as Data[], dateIndex: new Map<string, number>() };

    const dateIndex = new Map<string, number>();
    for (let i = 0; i < dates.length; i++) dateIndex.set(dates[i]!, i);

    const usd: Data[] = [];
    const percent: Data[] = [];

    for (const a of assets) {
      const yUsd: number[] = stacked.perAssetUsd.get(a) || new Array(dates.length).fill(0);
      const lc = colorFor(a);
      const visible = hiddenStackedAssets.has(a) ? 'legendonly' : true;

      usd.push({
        x: dates,
        y: yUsd,
        type: 'scatter',
        mode: 'lines',
        stackgroup: 'one',
        name: a,
        line: { color: lc, width: 0.5 },
        fillcolor: withAlpha(lc, 0.25),
        // Disable Plotly hover labels; we'll render a custom unified list.
        hoverinfo: 'none',
        hovertemplate: '<extra></extra>',
        visible,
      } as Data);

      const yPct: number[] = yUsd.map((v: number, i: number) => {
        const t = stacked.totals[i] || 0;
        return t > 0 ? (v / t) * 100 : 0;
      });

      percent.push({
        x: dates,
        y: yPct,
        type: 'scatter',
        mode: 'lines',
        stackgroup: 'one',
        name: a,
        line: { color: lc, width: 0.5 },
        fillcolor: withAlpha(lc, 0.25),
        hoverinfo: 'none',
        hovertemplate: '<extra></extra>',
        visible,
      } as Data);
    }

    return { usd, percent, dateIndex };
  }, [stacked, assets, colorFor, hiddenStackedAssets]);

  const [stackedHoverDate, setStackedHoverDate] = useState<string | null>(null);
  const normalizeHoverDate = useCallback((x: unknown): string | null => {
    if (!x) return null;
    if (typeof x === 'string') {
      const m = x.match(/^(\d{4}-\d{2}-\d{2})/);
      if (m?.[1]) return m[1];
      const d = new Date(x);
      return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
    }
    if (typeof x === 'number') {
      const d = new Date(x);
      return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
    }
    if (x instanceof Date) return x.toISOString().slice(0, 10);
    return null;
  }, []);

  const stackedHoverItems = useMemo(() => {
    if (!stackedHoverDate) return null;
    const di = stackedTraces.dateIndex.get(stackedHoverDate);
    if (di === undefined) return null;

    const total = stacked.totals[di] || 0;
    if (total <= 0) return { date: stackedHoverDate, total: 0, items: [] as Array<{ asset: string; value: number }> };

    const items: Array<{ asset: string; value: number }> = [];
    for (const a of assets) {
      if (hiddenStackedAssets.has(a)) continue;
      const yUsd = stacked.perAssetUsd.get(a);
      const v = yUsd ? (yUsd[di] || 0) : 0;
      if (v > 0) {
        items.push({ asset: a, value: stackedMode === 'percent' ? (v / total) * 100 : v });
      }
    }
    items.sort((x, y) => y.value - x.value);
    return { date: stackedHoverDate, total, items };
  }, [stackedHoverDate, stackedTraces.dateIndex, stacked.totals, stacked.perAssetUsd, assets, stackedMode, hiddenStackedAssets]);

  const handleStackedLegendClick = useCallback((evt: unknown) => {
    // Use legend click to control visibility state ourselves.
    const e = evt as { curveNumber?: number; data?: Array<{ name?: string }> } | null;
    const curve = e?.curveNumber;
    const name = (typeof curve === 'number' ? e?.data?.[curve]?.name : undefined) ?? undefined;
    if (!name) return false;
    setHiddenStackedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
    // Prevent Plotly default toggling; we control it via `visible`.
    return false;
  }, []);

  const handleStackedLegendDoubleClick = useCallback((evt: unknown) => {
    // Default Plotly behavior is "isolate one trace". We'll emulate it in our state.
    const e = evt as { curveNumber?: number; data?: Array<{ name?: string }> } | null;
    const curve = e?.curveNumber;
    const name = (typeof curve === 'number' ? e?.data?.[curve]?.name : undefined) ?? undefined;
    if (!name) return false;
    setHiddenStackedAssets((prev) => {
      const all = new Set<string>(assets);
      // If currently already isolated (all others hidden), reset to show all.
      const othersHidden = Array.from(all).filter((a) => a !== name).every((a) => prev.has(a));
      if (othersHidden && !prev.has(name)) return new Set();
      const next = new Set<string>();
      for (const a of all) if (a !== name) next.add(a);
      return next;
    });
    return false;
  }, [assets]);

  // PnL over time (realized/unrealized split) - per-asset only
  const pnl = useMemo(() => {
    if (!hist || !hist.prices || assets.length === 0 || !txs || txs.length === 0 || !selectedPnLAsset) {
      return { dates: [] as string[], realized: [] as number[], unrealized: [] as number[] };
    }
    const priceMap = new Map<string, number>();
    for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);

    const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();

    // Filter transactions by selected asset (per-asset view only)
    const filteredTxs = txs
      .filter(t => {
        if (t.type === 'Swap') {
          return t.toAsset.toUpperCase() === selectedPnLAsset || t.fromAsset?.toUpperCase() === selectedPnLAsset;
        }
        return false;
      })
      .filter(t => {
        // Exclude pure stablecoin operations
        return ![...STABLECOINS, 'USD'].includes(selectedPnLAsset);
      });

    // Only the selected asset is relevant
    const relevantAssets = [selectedPnLAsset];

    // Helper to compute series for a subset of transactions (single portfolio)
    const computeSeries = (subset: typeof filteredTxs) => {
      type TxEnriched = { asset: string; type: 'Buy'|'Sell'; units: number; unitPrice: number };
      const txByDate = new Map<string, TxEnriched[]>();
      for (const t of subset) {
        if (t.type !== 'Swap') continue;
        
        const day = new Date(new Date(t.datetime).getFullYear(), new Date(t.datetime).getMonth(), new Date(t.datetime).getDate()).toISOString().slice(0, 10);
        const key = day;
        const arr = txByDate.get(key) || [];
        
        // Determine if buying or selling the selected asset
        if (t.toAsset.toUpperCase() === selectedPnLAsset) {
          // Buying this asset
          const asset = t.toAsset.toUpperCase();
          const units = Math.abs(t.toQuantity);
          const unitPrice = t.toPriceUsd || priceMap.get(day + '|' + asset) || 0;
          arr.push({ asset, type: 'Buy' as const, units, unitPrice });
        } else if (t.fromAsset?.toUpperCase() === selectedPnLAsset) {
          // Selling this asset
          const asset = t.fromAsset.toUpperCase();
          const units = Math.abs(t.fromQuantity || 0);
          const unitPrice = t.fromPriceUsd || priceMap.get(day + '|' + asset) || 0;
          arr.push({ asset, type: 'Sell' as const, units, unitPrice });
        }
        
        txByDate.set(key, arr);
      }

      const heldUnits = new Map<string, number>();
      const heldCost = new Map<string, number>();
      let realizedCum = 0;
      const realizedSeries: number[] = [];
      const unrealizedSeries: number[] = [];
      for (const d of dates) {
        const todays = txByDate.get(d) || [];
        for (const tx of todays) {
          const uPrev = heldUnits.get(tx.asset) || 0;
          const cPrev = heldCost.get(tx.asset) || 0;
          if (tx.type === 'Buy') {
            heldUnits.set(tx.asset, uPrev + tx.units);
            heldCost.set(tx.asset, cPrev + tx.units * tx.unitPrice);
          } else {
            const avg = uPrev > 0 ? (cPrev / uPrev) : 0;
            const qty = Math.min(tx.units, uPrev);
            const proceeds = tx.unitPrice * qty;
            const cost = avg * qty;
            realizedCum += (proceeds - cost);
            heldUnits.set(tx.asset, uPrev - qty);
            heldCost.set(tx.asset, cPrev - cost);
          }
        }
        let marketValue = 0;
        let remainingCost = 0;
        for (const a of relevantAssets) {
          const units = heldUnits.get(a) || 0;
          const cost = heldCost.get(a) || 0;
          const price = priceMap.get(d + '|' + a) || 0;
          marketValue += units * price;
          remainingCost += cost;
        }
        realizedSeries.push(Number(realizedCum.toFixed(2)));
        unrealizedSeries.push(Number((marketValue - remainingCost).toFixed(2)));
      }
      return { realizedSeries, unrealizedSeries };
    };

    // If viewing all portfolios, compute per-portfolio and sum series
    const isAllPortfolios = selectedId === 'all';
    if (isAllPortfolios) {
      const byPortfolio: Record<string, typeof filteredTxs> = {};
      for (const t of filteredTxs) {
        const pid = String(t.portfolioId ?? 'unknown');
        (byPortfolio[pid] ||= []).push(t);
      }
      const realized = new Array(dates.length).fill(0);
      const unrealized = new Array(dates.length).fill(0);
      for (const subset of Object.values(byPortfolio)) {
        const { realizedSeries, unrealizedSeries } = computeSeries(subset);
        for (let i = 0; i < dates.length; i++) {
          realized[i] += realizedSeries[i] || 0;
          unrealized[i] += unrealizedSeries[i] || 0;
        }
      }
      return { dates, realized, unrealized };
    }

    // Single portfolio case
    const { realizedSeries, unrealizedSeries } = computeSeries(filteredTxs);
    return { dates, realized: realizedSeries, unrealized: unrealizedSeries };
  }, [hist, txs, assets, selectedPnLAsset, selectedId]);

  // Cost Basis vs Portfolio Valuation Over Time
  const costVsValuation = useMemo(() => {
    if (!hist || !hist.prices || assets.length === 0 || !txs || txs.length === 0) {
      return { dates: [] as string[], costBasis: [] as number[], portfolioValue: [] as number[] };
    }

    const dates = priceIndex.dates;
    const costBasis: number[] = [];
    const portfolioValue: number[] = [];

    const txDate = (dt: string) => {
      const d = new Date(dt);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    // Calculate cumulative cost basis and portfolio value for each date
    dates.forEach(date => {
      // Calculate cost basis up to this date (deposits - withdrawals)
      let cumulativeCost = 0;
      const fiatCurrencies = getFiatCurrencies();
      const dayEnd = new Date(date + 'T23:59:59Z');

      // Process all transactions up to this date
      txs
        .filter(tx => {
          const d = txDate(tx.datetime);
          return d ? d <= dayEnd : false;
        })
        .forEach(tx => {
        if (tx.type === 'Deposit') {
          // Deposits add to cost basis (money in)
          // Cost basis = fiat amount deposited in USD (fromQuantity * fromPriceUsd)
          // NOT the stablecoin received value, which includes exchange rate effects
          const depositValue = tx.fromQuantity && tx.fromPriceUsd 
            ? tx.fromQuantity * tx.fromPriceUsd 
            : tx.toQuantity * (tx.toPriceUsd || 1); // Fallback for old transactions
          cumulativeCost += depositValue;
        } else if (tx.type === 'Withdrawal') {
          // Withdrawals reduce cost basis (money out)
          // Cost basis = stablecoin amount withdrawn in USD (fromQuantity * fromPriceUsd)
          // NOT the fiat received value, which includes exchange rate effects
          const withdrawalValue = tx.fromQuantity && tx.fromPriceUsd 
            ? tx.fromQuantity * tx.fromPriceUsd 
            : tx.toQuantity * (tx.toPriceUsd || 1); // Fallback for old transactions
          cumulativeCost -= withdrawalValue;
        }
        // Note: Swap transactions don't affect cost basis directly
        // as they represent exchanges between assets, not new money invested
      });

      // Calculate portfolio value at this date
      let portfolioVal = 0;
      // Calculate historical crypto holdings up to this date
      const historicalHoldings: Record<string, number> = {};
      assets.forEach(asset => {
        historicalHoldings[asset] = 0;
      });

      // Process all transactions up to this date to calculate holdings
      txs.filter(tx => new Date(tx.datetime) <= new Date(date)).forEach(tx => {
        if (tx.type === 'Swap') {
          // Swap: remove from fromAsset, add to toAsset
          if (tx.fromAsset) {
            historicalHoldings[tx.fromAsset] = (historicalHoldings[tx.fromAsset] || 0) - (tx.fromQuantity || 0);
          }
          historicalHoldings[tx.toAsset] = (historicalHoldings[tx.toAsset] || 0) + tx.toQuantity;
        } else if (tx.type === 'Deposit') {
          historicalHoldings[tx.toAsset] = (historicalHoldings[tx.toAsset] || 0) + tx.toQuantity;
        } else if (tx.type === 'Withdrawal') {
          // Withdrawal: remove stablecoin from holdings (fromAsset is the stablecoin)
          if (tx.fromAsset) {
            historicalHoldings[tx.fromAsset] = (historicalHoldings[tx.fromAsset] || 0) - (tx.fromQuantity || 0);
          }
        }
      });

      // Add crypto holdings value at this date
      assets.forEach(asset => {
        const assetUnits = historicalHoldings[asset];
        if (assetUnits && assetUnits > 0) {
          const ai = priceIndex.assetIndex[asset];
          const di = priceIndex.dateIndex[date];
          let px = ai !== undefined && di !== undefined ? priceIndex.prices[ai][di] : 0;
          
          // For stablecoins, default to $1 if no price data available
          if ((px === 0 || px === undefined) && isStablecoin(asset)) {
            px = 1.0;
          }
          
          if (px > 0) portfolioVal += assetUnits * px;
        }
      });

      // Note: Cash balance is NOT added to portfolio value here because:
      // 1. Cash balance is already included in cost basis
      // 2. Portfolio value should only represent the value of invested assets (crypto)
      // 3. Adding cash would double-count it in the comparison

      costBasis.push(cumulativeCost);
      portfolioValue.push(portfolioVal);
    });

    return { dates, costBasis, portfolioValue };
  }, [hist, txs, assets, fxRateMap, priceIndex.dates, priceIndex.assetIndex, priceIndex.dateIndex, priceIndex.prices]);

  const fxReady = fxRateMap.size > 0;

  // Total Net Worth Over Time (Crypto ex-stables + Stablecoins)
  const netWorthOverTime = useMemo(() => {
    if (!hist || !hist.prices || assets.length === 0 || !txs || txs.length === 0) {
      return { dates: [] as string[], cryptoExStableValue: [] as number[], stableValue: [] as number[], totalValue: [] as number[] };
    }

    const dates = priceIndex.dates;
    const cryptoExStableValues: number[] = [];
    const stableValues: number[] = [];
    const totalValues: number[] = [];

    for (const date of dates) {
      // Calculate crypto portfolio value for this date using historical positions, split by stablecoin vs non-stable.
      let cryptoExStable = 0;
      let stableValue = 0;
      for (const asset of assets) {
        const ai = priceIndex.assetIndex[asset];
        const di = priceIndex.dateIndex[date];
        let price = ai !== undefined && di !== undefined ? priceIndex.prices[ai][di] : 0;
        
        // For stablecoins, default to $1 if no price data available
        if ((price === 0 || price === undefined) && isStablecoin(asset)) {
          price = 1.0;
        }
        
        // Calculate position at this historical date
        let position = 0;
        const relevantTxs = txs.filter(tx => 
          new Date(tx.datetime) <= new Date(date + 'T23:59:59')
        );
        
        for (const tx of relevantTxs) {
          if (tx.type === 'Swap') {
            // Check if this asset is being bought or sold
            if (tx.toAsset.toUpperCase() === asset) {
              position += tx.toQuantity;
            }
            if (tx.fromAsset?.toUpperCase() === asset) {
              position -= (tx.fromQuantity || 0);
            }
          } else if (tx.type === 'Deposit' && tx.toAsset.toUpperCase() === asset) {
            position += tx.toQuantity;
          } else if (tx.type === 'Withdrawal' && tx.fromAsset?.toUpperCase() === asset) {
            // Withdrawal: remove stablecoin from holdings (fromAsset is the stablecoin)
            position -= (tx.fromQuantity || 0);
          }
        }

        const value = position * price;
        if (isStablecoin(asset)) stableValue += value;
        else cryptoExStable += value;
      }

      const totalValue = cryptoExStable + stableValue;

      cryptoExStableValues.push(cryptoExStable);
      stableValues.push(stableValue);
      totalValues.push(totalValue);
    }

    return { dates, cryptoExStableValue: cryptoExStableValues, stableValue: stableValues, totalValue: totalValues };
  }, [hist, assets, txs, priceIndex.dates, priceIndex.assetIndex, priceIndex.dateIndex, priceIndex.prices]);

  const netWorthChartModel = useMemo(() => buildNetWorthLineChartModel(netWorthOverTime), [netWorthOverTime]);

  // Cost basis vs market price for selected asset (independent selector)
  const costVsPrice = useMemo(() => {
    if (!hist || !hist.prices || !selectedCostAsset) return { dates: [] as string[], avgCost: [] as number[], price: [] as number[] };
    const asset = selectedCostAsset.toUpperCase();
    const dates = Array.from(new Set(hist.prices.filter(p => p.asset.toUpperCase() === asset).map(p => p.date))).sort();
    // build tx map for this asset
    const txsA = (txs || []).filter(t => {
      if (t.type === 'Swap') {
        return t.toAsset.toUpperCase() === asset || t.fromAsset?.toUpperCase() === asset;
      }
      return false;
    }).map(t => {
      const date = new Date(new Date(t.datetime).getFullYear(), new Date(t.datetime).getMonth(), new Date(t.datetime).getDate()).toISOString().slice(0,10);
      // Check if buying or selling this asset
      if (t.toAsset.toUpperCase() === asset) {
        // Buying this asset
        return { date, type: 'Buy' as const, units: Math.abs(t.toQuantity), unitPrice: t.toPriceUsd || 0 };
      } else {
        // Selling this asset
        return { date, type: 'Sell' as const, units: Math.abs(t.fromQuantity || 0), unitPrice: t.fromPriceUsd || 0 };
      }
    });
    const txByDate = new Map<string, { type:'Buy'|'Sell'; units:number; unitPrice:number }[]>();
    for (const tx of txsA) { const arr = txByDate.get(tx.date) || []; arr.push(tx); txByDate.set(tx.date, arr); }
    let units = 0; let costVal = 0;
    const avgCost: number[] = [];
    const price: number[] = [];
    const priceMap = new Map<string, number>();
    for (const p of hist.prices.filter(p=>p.asset.toUpperCase()===asset)) priceMap.set(p.date, p.price_usd);
    for (const d of dates) {
      const todays = txByDate.get(d) || [];
      for (const tx of todays) {
        if (tx.type === 'Buy') { units += tx.units; costVal += tx.units * tx.unitPrice; }
        else {
          const avg = units>0 ? costVal/units : 0; const qty = Math.min(tx.units, units);
          costVal -= avg * qty; units -= qty;
        }
      }
      const avg = units>0 ? costVal/units : 0;
      avgCost.push(Number(avg.toFixed(6)));
      price.push(priceMap.get(d) || 0);
    }
    return { dates, avgCost, price };
  }, [hist, txs, selectedCostAsset]);

  const positionsFigure = useMemo(()=>{
    // one trace per asset (cumulative positions by date)
    const groups = new Map<string, { x:string[]; y:number[] }>();
    for (const r of dailyPos){
      const g = groups.get(r.asset) || { x:[], y:[] };
      g.x.push(r.date); g.y.push(r.position);
      groups.set(r.asset, g);
    }

    const data: Data[] = ((()=>{
      if (selectedAsset && groups.has(selectedAsset)) {
        const g = groups.get(selectedAsset)!;
        const text = g.x.map(d=> notesByDayAsset.get(`${d}|${selectedAsset}`) || '');
        return [{
          x: g.x,
          y: g.y,
          type: 'scatter',
          mode: 'lines+markers',
          name: selectedAsset,
          line: { shape: 'hv', color: colorFor(selectedAsset) },
          marker: { size: 5, color: colorFor(selectedAsset) },
          text,
          hovertemplate: `%{x}<br>Position: %{y}<br>%{text}<extra></extra>`,
        } as Data];
      }
      return Array.from(groups.entries()).map(([asset, g])=> {
        const text = g.x.map(d=> notesByDayAsset.get(`${d}|${asset}`) || '');
        const c = colorFor(asset);
        return ({
          x: g.x,
          y: g.y,
          type: 'scatter',
          mode: 'lines+markers',
          name: asset,
          line: { shape: 'hv', color: c },
          marker: { size: 5, color: c },
          text,
          hovertemplate: `%{x}<br>Position: %{y}<br>%{text}<extra></extra>`,
        } as Data);
      });
    })());
    const layout: Partial<Layout> = { autosize:true, height:320, margin:{ t:30, r:10, l:40, b:40 }, legend:{ orientation:'h' } };
    return { data, layout };
  }, [dailyPos, selectedAsset, colorFor, notesByDayAsset]);

  // Prepare allocation data for shared component
  const allocationData = useMemo(() => {
    return Object.entries(holdings)
      .map(([asset, units]) => {
        // For stablecoins, default price to $1 if not available from API
        let price = latestPrices[asset];
        if (price === undefined || price === 0) {
          if (isStablecoin(asset)) {
            price = 1.0;
          } else {
            price = 0;
          }
        }
        return { asset, units, value: price * units };
      })
      .filter(p => p.value > 0);
  }, [holdings, latestPrices]);


  // Summary cards: current balance, 24h change, total P/L, top performer 24h
  const summary = useMemo(() => {
    const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
    const nf2 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
    const nf6 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });
    let currentValue = 0;
    let currentValueBtc = 0;
    let dayChange = 0;
    let dayChangePct = 0;
    let topAsset = '';
    let topDelta = 0;

    if (latestPrices && Object.keys(latestPrices).length > 0) {
      for (const [a, units] of Object.entries(holdings)) {
        if (units <= 0) continue;
        // For stablecoins, default price to $1 if not available from API
        let price = latestPrices[a];
        if (price === undefined || price === 0) {
          price = isStablecoin(a) ? 1.0 : 0;
        }
        currentValue += price * units;
      }
      const btcPrice = latestPrices['BTC'] || 0;
      if (btcPrice > 0) currentValueBtc = currentValue / btcPrice;
    }

    // 24h change uses current prices vs prices from 24h ago (or last available historical date)
    if (hist && hist.prices && hist.prices.length > 0) {
      const dates = Array.from(new Set(hist.prices.map(p=>p.date))).sort();
      const n = dates.length;
      if (n >= 1) {
        // Use the last available historical date as reference (24h ago or closest)
        const prevDate = dates[n-1];
        const prevMap = new Map<string, number>();
        for (const p of hist.prices) {
          if (p.date === prevDate) prevMap.set(p.asset.toUpperCase(), p.price_usd);
        }
        topDelta = -Infinity; topAsset = '';
        for (const [a, units] of Object.entries(holdings)) {
          if (units <= 0) continue; // only assets currently held
          // Exclude stablecoins from 24h change calculation (they maintain $1.00 value)
          if (isStablecoin(a)) continue;
          // Use latestPrices for current price (most up-to-date)
          const cp = latestPrices[a] || 0;
          // Use historical price from previous date as reference
          const pp = prevMap.get(a) ?? cp;
          const delta = (cp - pp) * units;
          dayChange += delta;
          if (delta > topDelta) { topDelta = delta; topAsset = a; }
        }
        if (currentValue > 0) dayChangePct = (dayChange / (currentValue - dayChange)) * 100;
      }
    }

    // Use shared P&L calculation
    const totalPL = pnlData.totalPnL;
    const totalPLPct = pnlData.totalPnLPercent;

    return {
      currentValue,
      currentValueText: `$${nf0.format(currentValue)}`,
      currentValueBtcText: currentValueBtc>0? `${nf6.format(currentValueBtc)} BTC` : '',
      dayChangeText: `${dayChange>=0?'+':''}$${nf2.format(Math.abs(dayChange))}`,
      dayChangePctText: `${dayChange>=0?'▲':'▼'} ${nf2.format(Math.abs(dayChangePct))}%`,
      totalPLText: `${totalPL>=0?'+':''}$${nf0.format(Math.abs(totalPL))}`,
      totalPLPctText: `${totalPL>=0?'▲':'▼'} ${nf2.format(Math.abs(totalPLPct))}%`,
      topAsset,
      topDeltaText: topAsset ? `${topDelta>=0?'+':''}$${nf0.format(Math.abs(topDelta))}` : '',
    };
  }, [latestPrices, holdings, hist, pnlData]);

  // BTC Ratio Chart - tracks portfolio BTC value over time (single-pass incremental)
  const btcRatio = useMemo(() => {
    if (!hist || !hist.prices || assets.length === 0 || !txs || txs.length === 0) {
      return { dates: [] as string[], btcValue: [] as number[], btcPercentage: [] as number[] };
    }

    // Price lookup per date+asset
    const priceMap = new Map<string, number>();
    for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);

    // Sorted unique price dates (these are the x-axis)
    const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();

    // Group crypto buy/sell transactions by YYYY-MM-DD once
    const txsByDate = new Map<string, { asset: string; type: 'Buy' | 'Sell'; qty: number }[]>();
    for (const t of txs) {
      const day = new Date(t.datetime).toISOString().slice(0, 10);
      const arr = txsByDate.get(day) || [];
      
      if (t.type === 'Swap') {
        // For Swap: toAsset is what we're buying, fromAsset is what we're selling
        if (t.toAsset) {
          const toA = t.toAsset.toUpperCase();
          if (toA !== 'USD') {
            arr.push({ asset: toA, type: 'Buy' as const, qty: Math.abs(t.toQuantity) });
          }
        }
        if (t.fromAsset) {
          const fromA = t.fromAsset.toUpperCase();
          if (fromA !== 'USD') {
            arr.push({ asset: fromA, type: 'Sell' as const, qty: Math.abs(t.fromQuantity || 0) });
          }
        }
      } else if (t.type === 'Deposit') {
        // Deposit: add to holdings
        const toA = t.toAsset.toUpperCase();
        if (toA !== 'USD') {
          arr.push({ asset: toA, type: 'Buy' as const, qty: Math.abs(t.toQuantity) });
        }
      } else if (t.type === 'Withdrawal') {
        // Withdrawal: remove stablecoin from holdings (fromAsset is the stablecoin)
        const fromA = t.fromAsset?.toUpperCase();
        if (fromA && fromA !== 'USD') {
          arr.push({ asset: fromA, type: 'Sell' as const, qty: Math.abs(t.fromQuantity || 0) });
        }
      }
      txsByDate.set(day, arr);
    }

    // Current holdings snapshot updated incrementally as we sweep dates
    const currentHoldings: Record<string, number> = {};
    for (const a of assets) currentHoldings[a] = currentHoldings[a] || 0;

    const btcValue: number[] = new Array(dates.length);
    const btcPercentage: number[] = new Array(dates.length);

    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];

      // Apply this day's transactions (if any)
      const todays = txsByDate.get(date);
      if (todays && todays.length) {
        for (const tx of todays) {
          if (tx.type === 'Buy') {
            currentHoldings[tx.asset] = (currentHoldings[tx.asset] || 0) + tx.qty;
          } else {
            currentHoldings[tx.asset] = (currentHoldings[tx.asset] || 0) - tx.qty;
          }
        }
      }

      // Compute BTC value and total portfolio value for this date
      let totalValueUsd = 0;
      let btcValueUsd = 0;
      for (const a of assets) {
        const price = priceMap.get(date + '|' + a) || 0;
        const units = currentHoldings[a] || 0;
        if (units === 0 || price === 0) continue;
        const value = units * price;
        totalValueUsd += value;
        if (a === 'BTC') btcValueUsd = value;
      }

      btcValue[i] = btcValueUsd;
      btcPercentage[i] = totalValueUsd > 0 ? (btcValueUsd / totalValueUsd) * 100 : 0;
    }

    return { dates, btcValue, btcPercentage };
  }, [hist, assets, txs]);

  // Altcoin vs BTC Performance Chart
  const altcoinVsBtc = useMemo(() => {
    if (!hist || !hist.prices || assets.length === 0 || !txs || txs.length === 0) {
      return { dates: [] as string[], performance: {} as Record<string, number[]> };
    }
    
    const priceMap = new Map<string, number>();
    for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);
    
    const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
    const performance: Record<string, number[]> = {};
    
    // Calculate daily positions for each asset
    const dailyPositions = new Map<string, Record<string, number>>();
    
    // Initialize positions for each date
    for (const date of dates) {
      dailyPositions.set(date, {});
    }
    
    // Calculate cumulative positions for each asset over time
    for (const asset of assets) {
      let currentPosition = 0;
      
      for (const date of dates) {
        // Find all transactions for this asset up to this date
        const relevantTxs = txs.filter(tx => 
          new Date(tx.datetime).toISOString().slice(0, 10) <= date
        );
        
        // Calculate position for this asset up to this date
        currentPosition = relevantTxs.reduce((pos, tx) => {
          if (tx.type === 'Swap') {
            if (tx.toAsset.toUpperCase() === asset) {
              return pos + tx.toQuantity;
            }
            if (tx.fromAsset?.toUpperCase() === asset) {
              return pos - (tx.fromQuantity || 0);
            }
          } else if (tx.type === 'Deposit' && tx.toAsset.toUpperCase() === asset) {
            return pos + tx.toQuantity;
          } else if (tx.type === 'Withdrawal' && tx.fromAsset?.toUpperCase() === asset) {
            // Withdrawal: remove stablecoin from holdings (fromAsset is the stablecoin)
            return pos - (tx.fromQuantity || 0);
          }
          return pos;
        }, 0);
        
        dailyPositions.get(date)![asset] = currentPosition;
      }
    }
    
    // Calculate BTC value of holdings for each altcoin
    for (const asset of assets) {
      if (asset === 'BTC') continue; // Skip BTC itself
      
      const assetPerformance: number[] = [];
      for (const date of dates) {
        const assetPrice = priceMap.get(date + '|' + asset) || 0;
        const btcPrice = priceMap.get(date + '|' + 'BTC') || 0;
        const position = dailyPositions.get(date)?.[asset] || 0;
        
        if (btcPrice > 0 && position > 0) {
          // Calculate how much BTC your holdings of this altcoin are worth
          const assetValueUsd = position * assetPrice;
          const btcEquivalent = assetValueUsd / btcPrice;
          assetPerformance.push(btcEquivalent);
        } else {
          assetPerformance.push(0);
        }
      }
      performance[asset] = assetPerformance;
    }
    
    return { dates, performance };
  }, [hist, assets, txs]);

  // Profit-Taking Opportunities Chart
  const profitOpportunities = useMemo(() => {
    if (!hist || !hist.prices || assets.length === 0 || !txs || txs.length === 0) {
      return { dates: [] as string[], opportunities: {} as Record<string, { price: number[], signal: number[], altcoinPnL: number[], btcPnL: number[] }> };
    }
    
    const priceMap = new Map<string, number>();
    for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);
    
    const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
    const opportunities: Record<string, { price: number[], signal: number[], altcoinPnL: number[], btcPnL: number[] }> = {};
    
    for (const asset of assets) {
      if (asset === 'BTC') continue; // Skip BTC
      
      const prices: number[] = [];
      const signals: number[] = [];
      const altcoinPnL: number[] = [];
      const btcPnL: number[] = [];
      
      for (let i = 0; i < dates.length; i++) {
        const date = dates[i];
        const currentPrice = priceMap.get(date + '|' + asset) || 0;
        const currentBtcPrice = priceMap.get(date + '|' + 'BTC') || 0;
        prices.push(currentPrice);
        
        // Calculate cumulative position and cost basis for this asset up to this date
        const relevantTxs = txs.filter(tx => 
          new Date(tx.datetime).toISOString().slice(0, 10) <= date
        );
        
        let totalQuantity = 0;
        let totalCostUsd = 0;
        
        for (const tx of relevantTxs) {
          if (tx.type === 'Swap') {
            // Check if buying or selling this asset
            if (tx.toAsset.toUpperCase() === asset) {
              // Buying this asset
              const quantity = Math.abs(tx.toQuantity);
              totalQuantity += quantity;
              totalCostUsd += quantity * (tx.toPriceUsd || 0);
            } else if (tx.fromAsset?.toUpperCase() === asset) {
              // Selling this asset - use average cost method
              const quantity = Math.abs(tx.fromQuantity || 0);
              if (totalQuantity > 0) {
                const currentAvgCost = totalCostUsd / totalQuantity;
                const unitsToSell = Math.min(quantity, totalQuantity);
                totalCostUsd -= unitsToSell * currentAvgCost;
                totalQuantity -= unitsToSell;
              }
            }
          } else if (tx.type === 'Deposit' && tx.toAsset.toUpperCase() === asset) {
            // Deposit: add to holdings
            const quantity = Math.abs(tx.toQuantity);
            totalQuantity += quantity;
            totalCostUsd += quantity * (tx.toPriceUsd || 1);
          } else if (tx.type === 'Withdrawal' && tx.fromAsset?.toUpperCase() === asset) {
            // Withdrawal: remove stablecoin from holdings using average cost method (fromAsset is the stablecoin)
            const quantity = Math.abs(tx.fromQuantity || 0);
            if (totalQuantity > 0) {
              const currentAvgCost = totalCostUsd / totalQuantity;
              const unitsToWithdraw = Math.min(quantity, totalQuantity);
              totalCostUsd -= unitsToWithdraw * currentAvgCost;
              totalQuantity -= unitsToWithdraw;
            }
          }
        }
        
        // Calculate current altcoin PnL
        const currentValueUsd = totalQuantity * currentPrice;
        const altcoinPnLValue = currentValueUsd - totalCostUsd;
        altcoinPnL.push(altcoinPnLValue);
        
        // Calculate what BTC PnL would be if we had bought BTC instead
        let btcPnLValue = 0;
        // Only calculate BTC PnL if we currently have a position in this altcoin
        if (totalQuantity > 0 && totalCostUsd > 0 && currentBtcPrice > 0) {
          // Calculate how much BTC we could have bought with the same USD at the time of transactions
          let totalBtcQuantity = 0;
          let totalBtcCostUsd = 0;
          
          for (const tx of relevantTxs) {
            const txDate = new Date(tx.datetime).toISOString().slice(0, 10);
            const btcPriceAtTx = priceMap.get(txDate + '|' + 'BTC') || currentBtcPrice; // Use BTC price at transaction time
            
            if (tx.type === 'Swap' && tx.toAsset.toUpperCase() === asset) {
              // Buying this altcoin - calculate equivalent BTC purchase
              const quantity = Math.abs(tx.toQuantity);
              const costUsd = quantity * (tx.toPriceUsd || 0);
              const btcQuantity = costUsd / btcPriceAtTx;
              totalBtcQuantity += btcQuantity;
              totalBtcCostUsd += costUsd;
            } else if (tx.type === 'Swap' && tx.fromAsset?.toUpperCase() === asset) {
              // Selling this altcoin - reduce BTC position using average cost method
              const quantity = Math.abs(tx.fromQuantity || 0);
              if (totalBtcQuantity > 0) {
                const currentAvgBtcCost = totalBtcCostUsd / totalBtcQuantity;
                const costUsd = quantity * (tx.fromPriceUsd || 0);
                const btcQuantityToSell = costUsd / btcPriceAtTx;
                const unitsToSell = Math.min(btcQuantityToSell, totalBtcQuantity);
                totalBtcCostUsd -= unitsToSell * currentAvgBtcCost;
                totalBtcQuantity -= unitsToSell;
              }
            } else if (tx.type === 'Deposit' && tx.toAsset.toUpperCase() === asset) {
              // Deposit: calculate equivalent BTC purchase
              const quantity = Math.abs(tx.toQuantity);
              const costUsd = quantity * (tx.toPriceUsd || 1);
              const btcQuantity = costUsd / btcPriceAtTx;
              totalBtcQuantity += btcQuantity;
              totalBtcCostUsd += costUsd;
            } else if (tx.type === 'Withdrawal' && tx.fromAsset?.toUpperCase() === asset) {
              // Withdrawal: reduce BTC position using average cost method (fromAsset is the stablecoin)
              const quantity = Math.abs(tx.fromQuantity || 0);
              if (totalBtcQuantity > 0) {
                const currentAvgBtcCost = totalBtcCostUsd / totalBtcQuantity;
                const costUsd = quantity * (tx.fromPriceUsd || 1);
                const btcQuantityToSell = costUsd / btcPriceAtTx;
                const unitsToSell = Math.min(btcQuantityToSell, totalBtcQuantity);
                totalBtcCostUsd -= unitsToSell * currentAvgBtcCost;
                totalBtcQuantity -= unitsToSell;
              }
            }
          }
          
          // Calculate current BTC value using current BTC price
          const currentBtcValueUsd = totalBtcQuantity * currentBtcPrice;
          btcPnLValue = currentBtcValueUsd - totalBtcCostUsd;
        }
        btcPnL.push(btcPnLValue);
        
        // Profit-taking signal: when altcoin PnL > BTC PnL
        const signal = altcoinPnLValue > btcPnLValue && altcoinPnLValue > 0 ? 1 : 0;
        signals.push(signal);
      }
      
      opportunities[asset] = { price: prices, signal: signals, altcoinPnL, btcPnL };
    }
    
    return { dates, opportunities };
  }, [hist, assets, txs]);

  // BTC Accumulation Chart (single pass over dates with incremental holdings)
  const btcAccumulation = useMemo(() => {
    if (!txs || txs.length === 0 || !priceIndex.dates.length || !assets.length) {
      return { dates: [] as string[], btcHeld: [] as number[], altcoinBtcValue: [] as number[] };
    }

    const dates = priceIndex.dates;
    const btcIdx = priceIndex.assetIndex['BTC'];
    if (btcIdx === undefined) return { dates: [], btcHeld: [], altcoinBtcValue: [] };

    // Group transactions by date index and asset index once
    const txsByDate: { ai: number; dq: number }[][] = new Array(dates.length);
    for (let i = 0; i < dates.length; i++) txsByDate[i] = [];
    for (const t of txs) {
      const day = new Date(t.datetime).toISOString().slice(0, 10);
      const di = priceIndex.dateIndex[day];
      if (di === undefined) continue;
      
      if (t.type === 'Swap') {
        // For swaps: toAsset increases (buy), fromAsset decreases (sell)
        if (t.toAsset) {
          const toA = t.toAsset.toUpperCase();
          const ai = priceIndex.assetIndex[toA];
          if (ai !== undefined) {
            const dq = Math.abs(t.toQuantity);
            txsByDate[di].push({ ai, dq });
          }
        }
        if (t.fromAsset) {
          const fromA = t.fromAsset.toUpperCase();
          const ai = priceIndex.assetIndex[fromA];
          if (ai !== undefined) {
            const dq = -Math.abs(t.fromQuantity || 0);
            txsByDate[di].push({ ai, dq });
          }
        }
      } else if (t.type === 'Deposit') {
        const a = t.toAsset.toUpperCase();
        const ai = priceIndex.assetIndex[a];
        if (ai !== undefined) {
          const dq = Math.abs(t.toQuantity);
          txsByDate[di].push({ ai, dq });
        }
      } else if (t.type === 'Withdrawal') {
        // Withdrawal: remove stablecoin from holdings (fromAsset is the stablecoin)
        const a = t.fromAsset?.toUpperCase();
        if (a) {
          const ai = priceIndex.assetIndex[a];
          if (ai !== undefined) {
            const dq = -Math.abs(t.fromQuantity || 0);
            txsByDate[di].push({ ai, dq });
          }
        }
      }
    }

    // Rolling holdings for assets that are currently non-zero
    const held = new Map<number, number>();
    const btcHeld: number[] = new Array(dates.length);
    const altcoinBtcValue: number[] = new Array(dates.length);

    for (let di = 0; di < dates.length; di++) {
      const changes = txsByDate[di];
      if (changes && changes.length) {
        for (let k = 0; k < changes.length; k++) {
          const { ai, dq } = changes[k];
          const prev = held.get(ai) || 0;
          const next = Math.max(0, prev + dq); // Ensure holdings never go negative
          if (next === 0) held.delete(ai); else held.set(ai, next);
        }
      }

      const btcPrice = priceIndex.prices[btcIdx][di] || 0;
      const currentBtc = held.get(btcIdx) || 0;
      btcHeld[di] = currentBtc;

      let altBtc = 0;
      if (btcPrice > 0) {
        for (const [ai, qty] of held) {
          if (ai === btcIdx) continue;
          // Only calculate for positive holdings (negative holdings shouldn't exist, but guard against it)
          if (qty <= 0) continue;
          // Get asset symbol from index
          const asset = assets.find((_, idx) => priceIndex.assetIndex[assets[idx]!] === ai);
          // For stablecoins, use $1.00; otherwise use price from priceIndex
          const px = asset && isStablecoin(asset) 
            ? 1.0 
            : (priceIndex.prices[ai]?.[di] || 0);
          if (px > 0) {
            altBtc += (qty * px) / btcPrice;
          }
        }
      }
      // Ensure altcoin BTC value is never negative (can't have negative holdings)
      altcoinBtcValue[di] = Math.max(0, altBtc);
    }

    return { dates, btcHeld, altcoinBtcValue };
  }, [txs, priceIndex, assets]);


  // Portfolio Gains/Losses Heatmap
  const portfolioHeatmap = useMemo(() => {
    if (!txs || txs.length === 0 || !assets.length) {
      return { assets: [] as string[], pnlValues: [] as number[], colors: [] as string[] };
    }

    // Group transactions once by asset symbol (uppercased)
    const grouped: Record<string, typeof txs> = {};
    for (const t of txs) {
      // Group by all involved assets
      const assets: string[] = [];
      if (t.fromAsset) assets.push(t.fromAsset.toUpperCase());
      if (t.toAsset) assets.push(t.toAsset.toUpperCase());
      
      for (const a of assets) {
        (grouped[a] ||= []).push(t);
      }
    }

    const heatmapData: { asset: string; pnl: number; color: string }[] = [];

    // For timeframes, use the same approach as summary: find last two available dates
    let referencePriceMap: Map<string, number> | null = null;
    if (heatmapTimeframe !== 'current' && hist && hist.prices && hist.prices.length > 0) {
      const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
      const n = dates.length;
      if (n >= 2) {
        // For 24h, use last two dates. For 7d/30d, find appropriate date
        let targetDateIndex = n - 2; // Default to second-to-last date (24h)
        if (heatmapTimeframe === '7d' || heatmapTimeframe === '30d') {
          const daysBack = heatmapTimeframe === '7d' ? 7 : 30;
          const targetDate = new Date();
          targetDate.setDate(targetDate.getDate() - daysBack);
          const targetDateStr = targetDate.toISOString().slice(0, 10);
          // Find closest date <= target date
          for (let i = dates.length - 1; i >= 0; i--) {
            if (dates[i] <= targetDateStr) {
              targetDateIndex = i;
              break;
            }
          }
        }
        const referenceDate = dates[targetDateIndex];
        referencePriceMap = new Map<string, number>();
        for (const p of hist.prices) {
          if (p.date === referenceDate) {
            referencePriceMap.set(p.asset.toUpperCase(), p.price_usd);
          }
        }
      }
    }

    for (const asset of assets) {
      // Exclude stablecoins from timeframe-based calculations (they maintain $1.00 value)
      // But include them in "current" total PnL calculation
      if (heatmapTimeframe !== 'current' && isStablecoin(asset)) continue;
      
      const arr = grouped[asset] || [];
      let totalQuantity = 0;
      let totalCostUsd = 0;
      for (const tx of arr) {
        if (tx.type === 'Swap') {
          if (tx.toAsset.toUpperCase() === asset) {
            // Buying
            const quantity = Math.abs(tx.toQuantity);
            totalQuantity += quantity;
            totalCostUsd += quantity * (tx.toPriceUsd || 0);
          } else if (tx.fromAsset?.toUpperCase() === asset) {
            // Selling
            const quantity = Math.abs(tx.fromQuantity || 0);
            if (totalQuantity > 0) {
              const currentAvgCost = totalCostUsd / totalQuantity;
              const unitsToSell = Math.min(quantity, totalQuantity);
              totalCostUsd -= unitsToSell * currentAvgCost;
              totalQuantity -= unitsToSell;
            }
          }
        }
      }

      // Skip assets with zero or negative holdings
      if (totalQuantity <= 0) continue;

      let pnl: number;
      if (heatmapTimeframe === 'current') {
        // Total PnL: current value minus cost basis
        const currentPrice = latestPrices[asset] || 0;
        const currentValueUsd = totalQuantity * currentPrice;
        pnl = currentValueUsd - totalCostUsd;
      } else {
        // Timeframe change: use latestPrices for current, referencePriceMap for reference
        const currentPrice = latestPrices[asset] || 0;
        const referencePrice = referencePriceMap?.get(asset) ?? currentPrice;
        const currentValueUsd = totalQuantity * currentPrice;
        const referenceValueUsd = totalQuantity * referencePrice;
        pnl = currentValueUsd - referenceValueUsd;
      }

      const color = pnl >= 0 ? '#16a34a' : '#dc2626';
      heatmapData.push({ asset, pnl, color });
    }

    heatmapData.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
    return {
      assets: heatmapData.map(d => d.asset),
      pnlValues: heatmapData.map(d => d.pnl),
      colors: heatmapData.map(d => d.color),
    };
  }, [txs, assets, heatmapTimeframe, latestPrices, hist]);


  return (
    <AuthGuard redirectTo="/dashboard">
      <main>
      <h1>Dashboard</h1>
      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="label">Current Balance</div>
          <div className="value">{summary.currentValueText} {summary.currentValueBtcText? <span style={{ color:'var(--muted)', marginLeft:8 }}>({summary.currentValueBtcText})</span> : null}</div>
        </div>
        <div className="stat">
          <div className="label">24h Portfolio Change</div>
          <div className="value" style={{ color: (summary.dayChangeText.startsWith('+')? '#16a34a' : '#dc2626') }}>{summary.dayChangeText} <span style={{ color:'var(--muted)', fontSize: '0.9em' }}>{summary.dayChangePctText}</span></div>
        </div>
        <div className="stat">
          <div className="label">Stablecoin Balance</div>
          <div className="value" style={{ color: '#22c55e' }}>${stablecoinBalanceUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="stat">
          <div className="label">Total Profit / Loss</div>
          <div className="value" style={{ color: (summary.totalPLText.startsWith('+')? '#16a34a' : '#dc2626') }}>{summary.totalPLText} <span style={{ color:'var(--muted)', fontSize: '0.9em' }}>{summary.totalPLPctText}</span></div>
        </div>
        <div className="stat">
          <div className="label">Top Performer (24h)</div>
          <div className="value">{summary.topAsset || '—'} {summary.topAsset? <span style={{ color:'#16a34a', marginLeft:8 }}>{summary.topDeltaText}</span> : null}</div>
        </div>
      </div>

      {/* Portfolio Gains/Losses Heatmap */}
      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">
            <h2>Portfolio Gains/Losses Heatmap</h2>
            <button 
              onClick={() => alert(`Portfolio Gains/Losses Heatmap

This heatmap shows the profit and loss (PnL) for each asset in your portfolio.

• Block size represents the magnitude of gains/losses
• Green blocks = positive PnL (profits)
• Red blocks = negative PnL (losses)
• Larger blocks = bigger gains or losses

Timeframe options:
• Total PnL: Cumulative profit/loss since purchase
• 24h/7d/30d: PnL change over the specified period

Hover over blocks to see exact PnL values.`)}
              className="icon-btn"
              title="Chart Information"
            >
              ℹ️
            </button>
          </div>
          <div className="card-actions">
            <div className="segmented">
              <button className={heatmapTimeframe === 'current' ? 'active' : ''} onClick={() => setHeatmapTimeframe('current')}>Total PnL</button>
              <button className={heatmapTimeframe === '24h' ? 'active' : ''} onClick={() => setHeatmapTimeframe('24h')}>24h</button>
              <button className={heatmapTimeframe === '7d' ? 'active' : ''} onClick={() => setHeatmapTimeframe('7d')}>7d</button>
              <button className={heatmapTimeframe === '30d' ? 'active' : ''} onClick={() => setHeatmapTimeframe('30d')}>30d</button>
            </div>
          </div>
        </div>
        {(loadingTxs || loadingHist) && (
          <div style={{ padding: 16, color: 'var(--muted)' }}>Loading heatmap...</div>
        )}
        {!loadingTxs && !loadingHist && portfolioHeatmap.assets.length === 0 && (
          <div style={{ padding: 16, color: 'var(--muted)' }}>No data to display yet</div>
        )}
        {!loadingTxs && !loadingHist && portfolioHeatmap.assets.length > 0 && (
        <Plot
          data={[
            {
              type: 'treemap',
              labels: portfolioHeatmap.assets,
              parents: portfolioHeatmap.assets.map(() => ''),
              values: portfolioHeatmap.pnlValues.map(Math.abs),
              text: portfolioHeatmap.assets.map((asset, i) => 
                `${asset}<br>${portfolioHeatmap.pnlValues[i] >= 0 ? '+' : ''}${portfolioHeatmap.pnlValues[i].toLocaleString('en-US', { 
                  style: 'currency', 
                  currency: 'USD',
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0
                })}`
              ),
              textinfo: 'label+text',
              hovertemplate: '<b>%{label}</b><br>PnL: %{text}<extra></extra>',
              marker: {
                colors: portfolioHeatmap.colors,
                line: { width: 1, color: '#ffffff' }
              }
            }
          ] as Data[]}
                      layout={{
              autosize: true,
              height: 400,
              margin: { t: 30, r: 10, l: 10, b: 10 }
            }}
          style={{ width: '100%' }}
        />
        )}
      </section>

      {/* Top Row: Portfolio Overview */}
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <ChartCard
          title="Portfolio Allocation (incl. Stablecoins)"
          infoText={`Portfolio Allocation (incl. Stablecoins)

This pie chart shows how your total portfolio is distributed across different assets.

• Each slice represents an asset's percentage of your total portfolio value
• Includes cryptocurrency holdings, including stablecoins
• Hover over slices to see exact percentages and values
• Colors are assigned to each asset for easy identification

This gives you a complete picture of your total portfolio composition.`}
          timeframeEnabled={false}
        >
          {({ expanded }) => (
            <AllocationPieChart 
              data={allocationData}
              isLoading={loadingCurr && assets.length > 0}
              height={expanded ? 520 : 320}
            />
          )}
        </ChartCard>

        <ChartCard
          title="Total Net Worth Over Time"
          infoText={`Total Net Worth Over Time

This chart shows your portfolio value over time, split into:

• Blue line = Total net worth (crypto + stablecoins)
• Orange line = Crypto value excluding stablecoins
• Green line = Stablecoin balance

This gives you a clearer view of how much of your portfolio is in stable value vs directional crypto exposure.`}
        >
          {({ timeframe, expanded }) => {
            if (loadingTxs || loadingHist) return <div style={{ padding: 16, color: 'var(--muted)' }}>Loading net worth data...</div>;
            if (!netWorthOverTime.dates.length) return <div style={{ padding: 16, color: 'var(--muted)' }}>No net worth data</div>;
            const idx = sliceStartIndexForIsoDates(netWorthOverTime.dates, timeframe);
            const sliced = {
              dates: netWorthOverTime.dates.slice(idx),
              totalValue: netWorthOverTime.totalValue.slice(idx),
              cryptoExStableValue: netWorthOverTime.cryptoExStableValue.slice(idx),
              stableValue: netWorthOverTime.stableValue.slice(idx),
            };
            const model = buildNetWorthLineChartModel(sliced, { height: expanded ? undefined : 400 });
            return <LineChart model={model} style={expanded ? { height: '100%' } : undefined} />;
          }}
        </ChartCard>
      </div>

      {/* Second Row: Performance Analysis */}
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <ChartCard
          title="Cost Basis vs Portfolio Valuation"
          infoText={`Cost Basis vs Portfolio Valuation

This chart compares the total money you've invested (cost basis) with your current portfolio value over time.

• Blue line = Portfolio valuation (current market value)
• Red line = Cost basis (total deposits - withdrawals)
• Green area = Profit (when portfolio value > cost basis)
• Red area = Loss (when portfolio value < cost basis)

Cost basis represents the actual money you've put into your portfolio through deposits, minus any withdrawals. This shows your true investment performance - how much your money has grown or shrunk over time.

This is different from trading P&L as it focuses on your total investment vs. total value, not individual buy/sell transactions.`}
        >
          {({ timeframe, expanded }) => {
            if (loadingTxs || loadingHist || !fxReady) {
              return (
                <div style={{ padding: 16, color: 'var(--muted)' }}>
                  {loadingTxs || loadingHist ? 'Loading cost vs valuation data...' : 'Loading FX rates for cost basis...'}
                </div>
              );
            }
            if (!costVsValuation.dates.length) return <div style={{ padding: 16, color: 'var(--muted)' }}>No cost vs valuation data</div>;
            const idx = sliceStartIndexForIsoDates(costVsValuation.dates, timeframe);
            const x = costVsValuation.dates.slice(idx);
            const yVal = costVsValuation.portfolioValue.slice(idx);
            const yCost = costVsValuation.costBasis.slice(idx);
            return (
              <Plot
                data={[
                  {
                    x,
                    y: yVal,
                    type: 'scatter',
                    mode: 'lines',
                    name: 'Portfolio Value',
                    line: { color: '#3b82f6', width: 3 },
                    fill: 'tonexty',
                    fillcolor: 'rgba(59, 130, 246, 0.1)',
                  },
                  {
                    x,
                    y: yCost,
                    type: 'scatter',
                    mode: 'lines',
                    name: 'Cost Basis',
                    line: { color: '#dc2626', width: 3 },
                    fill: 'tozeroy',
                    fillcolor: 'rgba(220, 38, 38, 0.1)',
                  },
                ] as Data[]}
                layout={{
                  title: { text: 'Cost Basis vs Portfolio Valuation' },
                  xaxis: { title: { text: 'Date' } },
                  yaxis: { title: { text: 'Value (USD)' } },
                  height: expanded ? undefined : 400,
                  hovermode: 'x unified',
                  showlegend: true,
                }}
                style={{ width: '100%', height: expanded ? '100%' : undefined }}
              />
            );
          }}
        </ChartCard>

        <ChartCard
          title="BTC Ratio & Accumulation"
          infoText={`BTC Ratio & Accumulation

This chart shows your Bitcoin strategy metrics over time.

BTC Ratio (%):
• Shows what percentage of your portfolio is in Bitcoin
• Higher % = more Bitcoin-focused strategy
• Lower % = more diversified into altcoins

BTC Accumulation:
• Blue area = Actual BTC holdings
• Orange area = BTC value of altcoin holdings
• Total height = Total BTC equivalent value
• Helps visualize your "BTC maximization" strategy

Use the chart type selector to switch between views.`}
          headerActions={() => (
            <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
              Chart Type
              <select value={selectedBtcChart} onChange={e=>setSelectedBtcChart(e.target.value)}>
                <option value="ratio">BTC Ratio (%)</option>
                <option value="accumulation">BTC Accumulation</option>
              </select>
            </label>
          )}
        >
          {({ timeframe, expanded }) => {
            if (loadingHist || loadingTxs) return <div style={{ padding: 16, color: 'var(--muted)' }}>Loading BTC charts...</div>;
            const idx = sliceStartIndexForIsoDates(btcRatio.dates, timeframe);
            const dates = btcRatio.dates.slice(idx);
            const btcPct = btcRatio.btcPercentage.slice(idx);
            const btcHeld = btcAccumulation.btcHeld.slice(idx);
            const altBtc = btcAccumulation.altcoinBtcValue.slice(idx);
            const totalBtc = dates.map((_d: string, i: number) => (btcHeld[i] || 0) + (altBtc[i] || 0));

            return selectedBtcChart === 'ratio' ? (
              <Plot
                data={[
                  { x: dates, y: btcPct, type:'scatter', mode:'lines', name:'BTC % of Portfolio', line: { color: '#f7931a' } },
                ] as Data[]}
                layout={{ autosize:true, height: expanded ? undefined : 320, margin:{ t:30, r:10, l:40, b:40 }, legend:{ orientation:'h' }, yaxis: { title: { text: 'BTC % of Portfolio' } } }}
                style={{ width:'100%', height: expanded ? '100%' : undefined }}
              />
            ) : (
              <Plot
                data={[
                  { x: dates, y: btcHeld, type:'scatter', mode:'lines', name:'BTC Held', line:{ color:'#f7931a' }, fill:'tonexty', fillcolor:'rgba(247, 147, 26, 0.3)' },
                  { x: dates, y: altBtc, type:'scatter', mode:'lines', name:'Altcoin BTC Value', line:{ color:'#16a34a' }, fill:'tonexty', fillcolor:'rgba(22, 163, 74, 0.3)' },
                  { x: dates, y: totalBtc, type:'scatter', mode:'lines', name:'Total Portfolio BTC', line:{ color:'#3b82f6', width:3 }, fill:'tonexty', fillcolor:'rgba(59, 130, 246, 0.1)' },
                ] as Data[]}
                layout={{ autosize:true, height: expanded ? undefined : 320, margin:{ t:30, r:10, l:40, b:40 }, legend:{ orientation:'h' }, yaxis: { title: { text: 'BTC Amount' } }, hovermode:'x unified' }}
                style={{ width:'100%', height: expanded ? '100%' : undefined }}
              />
            );
          }}
        </ChartCard>
      </div>

      {/* Third Row: Detailed Analysis */}
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <section className="card">
          <div className="card-header">
            <div className="card-title">
              <h2>Positions over time (by asset)</h2>
              <button 
                onClick={() => alert(`Positions Over Time

This chart shows how your holdings in each asset have changed over time.

• Each line represents the quantity of an asset you hold
• Vertical jumps occur when you buy or sell
• Flat lines indicate no trading activity
• Use the asset filter to focus on specific assets
• Hover over points to see exact quantities and dates

This helps visualize your trading activity and position sizing over time.`)}
                className="icon-btn"
                title="Chart Information"
              >
                ℹ️
              </button>
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>Asset
              <select value={selectedAsset} onChange={e=>setSelectedAsset(e.target.value)}>
                {assets.map(a=> (<option key={a} value={a}>{a}</option>))}
              </select>
            </label>
          </div>
          {loadingTxs && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>Loading positions...</div>
          )}
          {!loadingTxs && positionsFigure.data.length === 0 && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>No positions to show</div>
          )}
          {!loadingTxs && positionsFigure.data.length > 0 && (
            <Plot data={positionsFigure.data} layout={positionsFigure.layout} style={{ width:'100%' }} />
          )}
        </section>
        <section className="card">
          <div className="card-header">
            <div className="card-title">
              <h2>Average cost vs market price ({selectedCostAsset || '...'})</h2>
              <button 
                onClick={() => alert(`Average Cost vs Market Price

This chart compares your average purchase price with the current market price.

• Dotted line = Your average cost basis (what you paid on average)
• Solid line = Current market price
• When market price > average cost = you're in profit
• When market price < average cost = you're at a loss
• The gap between lines shows your profit/loss per unit

This helps you understand your entry points and current profit margins.`)}
                className="icon-btn"
                title="Chart Information"
              >
                ℹ️
              </button>
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>Asset
              <select value={selectedCostAsset} onChange={e=>setSelectedCostAsset(e.target.value)}>
                {assets.map(a=> (<option key={a} value={a}>{a}</option>))}
              </select>
            </label>
          </div>
          {(loadingHist || !selectedCostAsset) && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>Loading cost vs price...</div>
          )}
          {!loadingHist && costVsPrice.dates.length === 0 && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>No data for selected asset</div>
          )}
          {!loadingHist && costVsPrice.dates.length > 0 && (
          <Plot
            data={[
              { x: costVsPrice.dates, y: costVsPrice.avgCost, type:'scatter', mode:'lines', name:'Avg cost', line: { color: '#888888', dash: 'dot' } },
              { x: costVsPrice.dates, y: costVsPrice.price, type:'scatter', mode:'lines', name:'Market price', line: { color: colorFor(selectedCostAsset||'') } },
            ] as Data[]}
            layout={{ autosize:true, height:320, margin:{ t:30, r:10, l:40, b:40 }, legend:{ orientation:'h' } }}
            style={{ width:'100%' }}
          />
          )}
        </section>
      </div>

      {/* Fourth Row: Portfolio Value Stacked */}
      <ChartCard
        title="Portfolio value over time (stacked, USD / %)"
        infoText={`Portfolio Value Over Time (Stacked)

This chart shows your portfolio value over time, broken down by asset (stacked area).

Use the "View" selector to switch between:

• USD: stacked by each asset's USD value
• Normalized (%): stacked by each asset's percentage share of the total (always sums to 100% when total > 0)

Notes:
• Assets are only drawn when their value is > 0 (inactive assets won't clutter the chart/hover)
• The total line represents the overall portfolio total (USD) or 100% (normalized)

This helps visualize portfolio growth and asset allocation changes over time.`}
        headerActions={() => (
          <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
            View
            <select value={stackedMode} onChange={(e: ChangeEvent<HTMLSelectElement>) => setStackedMode(e.target.value as 'usd' | 'percent')}>
              <option value="usd">USD</option>
              <option value="percent">Normalized (%)</option>
            </select>
          </label>
        )}
        style={{ marginBottom: 16 }}
      >
        {({ timeframe, expanded }) => {
          if (loadingHist) return <div style={{ padding: 16, color: 'var(--muted)' }}>Loading portfolio value...</div>;
          const baseSeries = stackedMode === 'percent' ? stackedTraces.percent : stackedTraces.usd;
          if (!baseSeries.length) return <div style={{ padding: 16, color: 'var(--muted)' }}>No historical data</div>;

          const idx = sliceStartIndexForIsoDates(stacked.dates, timeframe);
          const slicedSeries = (baseSeries as unknown as Array<{ x?: string[]; y?: number[] }>).map((tr) => {
            const x = Array.isArray(tr.x) ? tr.x.slice(idx) : tr.x;
            const y = Array.isArray(tr.y) ? tr.y.slice(idx) : tr.y;
            return { ...(tr as unknown as Record<string, unknown>), x, y } as unknown as Data;
          });

          return (
            <div style={{ position: 'relative' }}>
              <Plot
                data={slicedSeries as unknown as Data[]}
                layout={{
                  autosize: true,
                  height: expanded ? undefined : 340,
                  margin: { t: 30, r: 10, l: 40, b: 40 },
                  legend: { orientation: 'h' },
                  hovermode: 'x',
                  xaxis: { showspikes: true, spikemode: 'across', spikesnap: 'cursor', spikethickness: 1 },
                  yaxis:
                    stackedMode === 'percent'
                      ? { title: { text: 'Share of total (%)' }, ticksuffix: '%', range: [0, 100] }
                      : { title: { text: 'Value (USD)' } },
                }}
                style={{ width:'100%', height: expanded ? '100%' : undefined }}
                onHover={(evt: unknown) => {
                  const e = evt as { points?: Array<{ x?: unknown }> } | null;
                  const x = e?.points?.[0]?.x;
                  const day = normalizeHoverDate(x);
                  if (day) setStackedHoverDate(day);
                }}
                onUnhover={() => {}}
                onLegendClick={handleStackedLegendClick}
                onLegendDoubleClick={handleStackedLegendDoubleClick}
              />

              {stackedHoverItems && stackedHoverItems.items.length > 0 ? (
                <div
                  style={{
                    position: 'absolute',
                    left: 12,
                    top: 12,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '10px 12px',
                    color: 'var(--text)',
                    fontSize: 12,
                    lineHeight: 1.25,
                    minWidth: 220,
                    maxWidth: 280,
                    pointerEvents: 'none',
                    boxShadow: '0 10px 30px rgba(0,0,0,0.18)',
                  }}
                >
                  <div style={{ fontWeight: 800, marginBottom: 2 }}>{stackedHoverItems.date}</div>
                  <div style={{ color: 'var(--muted)', marginBottom: 8 }}>
                    Total:{' '}
                    {stackedMode === 'percent'
                      ? '100%'
                      : `$${(stackedHoverItems.total || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                  </div>

                  <div style={{ display: 'grid', gap: 6 }}>
                    {stackedHoverItems.items.map((it: { asset: string; value: number }) => (
                      <div key={it.asset} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                          <span
                            aria-hidden="true"
                            style={{
                              width: 18,
                              height: 0,
                              borderTop: `3px solid ${colorFor(it.asset)}`,
                              borderRadius: 2,
                              flex: '0 0 auto',
                            }}
                          />
                          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {it.asset}
                          </span>
                        </span>
                        <span>
                          {stackedMode === 'percent'
                            ? `${it.value.toFixed(2)}%`
                            : `$${it.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        }}
      </ChartCard>

      {/* Fifth Row: BTC Analysis */}
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <ChartCard
          title="PnL over time (per asset)"
          infoText={`PnL Over Time (Per Asset)

This chart shows your profit and loss (PnL) over time for the selected asset, split into realized and unrealized gains/losses.

• Realized PnL: Profits/losses from completed transactions (buys/sells)
• Unrealized PnL: Current paper gains/losses on the held position
• Total PnL = Realized + Unrealized

Use the asset selector to view PnL for a specific asset.
Note: Aggregated portfolio PnL is intentionally not shown to avoid misleading aggregation.`}
          headerActions={() => (
            <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
              Asset
              <select value={selectedPnLAsset} onChange={e=>setSelectedPnLAsset(e.target.value)}>
                {assets.map(a=> (<option key={a} value={a}>{a}</option>))}
              </select>
            </label>
          )}
        >
          {({ timeframe, expanded }) => {
            if (loadingTxs || loadingHist) return <div style={{ padding: 16, color: 'var(--muted)' }}>Loading PnL...</div>;
            if (!pnl.dates.length) return <div style={{ padding: 16, color: 'var(--muted)' }}>No PnL data</div>;
            const idx = sliceStartIndexForIsoDates(pnl.dates, timeframe);
            const dates = pnl.dates.slice(idx);
            return (
              <Plot
                data={[
                  { x: dates, y: pnl.realized.slice(idx), type:'scatter', mode:'lines', name:'Realized' },
                  { x: dates, y: pnl.unrealized.slice(idx), type:'scatter', mode:'lines', name:'Unrealized' },
                ] as Data[]}
                layout={{ autosize:true, height: expanded ? undefined : 320, margin:{ t:30, r:10, l:40, b:40 }, legend:{ orientation:'h' } }}
                style={{ width:'100%', height: expanded ? '100%' : undefined }}
              />
            );
          }}
        </ChartCard>

        <ChartCard
          title="Altcoin Holdings BTC Value"
          headerActions={() => (
            <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
              Asset
              <select value={selectedAltcoin} onChange={e=>setSelectedAltcoin(e.target.value)}>
                <option value="ALL">All Altcoins</option>
                {assets.filter(a => a !== 'BTC').map(a=> (<option key={a} value={a}>{a}</option>))}
              </select>
            </label>
          )}
        >
          {({ timeframe, expanded }) => {
            if (loadingHist || loadingTxs) return <div style={{ padding: 16, color: 'var(--muted)' }}>Loading performance...</div>;
            if (!altcoinVsBtc.dates.length) return <div style={{ padding: 16, color: 'var(--muted)' }}>No performance data</div>;
            const idx = sliceStartIndexForIsoDates(altcoinVsBtc.dates, timeframe);
            const dates = altcoinVsBtc.dates.slice(idx);
            const buildTrace = (asset: string) => ({
              x: dates,
              y: (altcoinVsBtc.performance[asset] || []).slice(idx),
              type: 'scatter' as const,
              mode: 'lines' as const,
              name: asset,
              line: { color: colorFor(asset) },
            });
            const traces =
              selectedAltcoin === 'ALL'
                ? assets.filter(a => a !== 'BTC').map(buildTrace)
                : [buildTrace(selectedAltcoin)];
            return (
              <Plot
                data={traces as unknown as Data[]}
                layout={{ autosize:true, height: expanded ? undefined : 320, margin:{ t:30, r:10, l:40, b:40 }, legend:{ orientation:'h' }, yaxis: { title: { text: 'BTC Value of Holdings' } } }}
                style={{ width:'100%', height: expanded ? '100%' : undefined }}
              />
            );
          }}
        </ChartCard>
      </div>

      {/* Sixth Row: Advanced Analysis */}
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <ChartCard
          title="Profit-Taking Opportunities (Altcoin vs BTC PnL)"
          infoText={`Profit-Taking Opportunities

This chart compares your altcoin PnL vs what BTC PnL would be if you had bought Bitcoin instead.

• Solid line = Your altcoin PnL (actual performance)
• Dashed line = BTC PnL (what you would have made with BTC)
• When altcoin line > BTC line = altcoin outperforming BTC
• When BTC line > altcoin line = BTC would have been better
• Only shows comparison when you have an active position

This helps identify when to take profits on altcoins vs holding BTC longer.

Use the asset selector to compare different altcoins.`}
          headerActions={() => (
            <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>
              Asset
              <select value={selectedProfitAsset} onChange={e=>setSelectedProfitAsset(e.target.value)}>
                {assets.filter(a => a !== 'BTC').map(a=> (<option key={a} value={a}>{a}</option>))}
              </select>
            </label>
          )}
        >
          {({ timeframe, expanded }) => {
            if (loadingHist || loadingTxs) return <div style={{ padding: 16, color: 'var(--muted)' }}>Loading opportunities...</div>;
            if (!profitOpportunities.dates.length) return <div style={{ padding: 16, color: 'var(--muted)' }}>No opportunities data</div>;
            const idx = sliceStartIndexForIsoDates(profitOpportunities.dates, timeframe);
            const dates = profitOpportunities.dates.slice(idx);

            const makeAssetTraces = (asset: string) => ([
              {
                x: dates,
                y: (profitOpportunities.opportunities[asset]?.altcoinPnL || []).slice(idx),
                type: 'scatter' as const,
                mode: 'lines' as const,
                name: `${asset} PnL`,
                line: { color: colorFor(asset) },
              },
              {
                x: dates,
                y: (profitOpportunities.opportunities[asset]?.btcPnL || []).slice(idx),
                type: 'scatter' as const,
                mode: 'lines' as const,
                name: 'BTC PnL (if bought instead)',
                line: { color: '#f7931a', dash: 'dash' },
              },
            ]);

            const traces = makeAssetTraces(selectedProfitAsset);

            return (
              <Plot
                data={traces as unknown as Data[]}
                layout={{ autosize:true, height: expanded ? undefined : 320, margin:{ t:30, r:10, l:40, b:40 }, legend:{ orientation:'h' }, yaxis:{ title:{ text:'PnL (USD)' } }, hovermode:'x unified' }}
                style={{ width:'100%', height: expanded ? '100%' : undefined }}
              />
            );
          }}
        </ChartCard>
      </div>
    </main>
    </AuthGuard>
  );
}
