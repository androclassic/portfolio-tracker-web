'use client';
import React, { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { getAssetColor, isStablecoin, getFiatCurrencies } from '@/lib/assets';
import { usePortfolio } from '../PortfolioProvider';
import AllocationPieChart from '@/components/AllocationPieChart';
import AuthGuard from '@/components/AuthGuard';
import { PlotlyChart as Plot } from '@/components/charts/plotly/PlotlyChart';
import { LineChart } from '@/components/charts/LineChart';
import { buildNetWorthLineChartModel } from '@/lib/chart-models/net-worth';
import { ChartCard } from '@/components/ChartCard';
import { sliceStartIndexForIsoDates, sampleDataPoints, sampleDataWithDates } from '@/lib/timeframe';
import DashboardDataProvider, { useDashboardData } from '../DashboardDataProvider';

import type { Layout, Data } from 'plotly.js';
import type { Transaction as Tx } from '@/lib/types';
import { STABLECOINS } from '@/lib/types';

function DashboardPageContent() {
  const renderStart = performance.now();
  const {
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
  } = useDashboardData();
  
  // Measure render time and log all useMemo computations
  React.useEffect(() => {
    const renderEnd = performance.now();
    const renderTime = renderEnd - renderStart;
    if (renderTime > 16) { // Only log if render takes longer than one frame (16ms)
      const renderTimeSec = (renderTime / 1000).toFixed(2);
      console.log(`[Performance] 🎨 Dashboard render: ${renderTime.toFixed(2)}ms (${renderTimeSec}s)`);
      console.log(`[Performance] 📊 Summary: ${assets.length} assets, ${txs?.length || 0} transactions, ${historicalPrices.length} prices, ${dailyPos?.length || 0} daily positions`);
    }
  }, [renderStart, assets.length, txs?.length, historicalPrices.length, dailyPos?.length]);

  const [selectedAsset, setSelectedAsset] = useState<string>('');
  const [selectedPnLAsset, setSelectedPnLAsset] = useState<string>('');
  const [selectedBtcChart, setSelectedBtcChart] = useState<string>('accumulation');
  const [selectedAltcoin, setSelectedAltcoin] = useState<string>('ALL');
  const [selectedProfitAsset, setSelectedProfitAsset] = useState<string>('ADA');
  const [selectedCostAsset, setSelectedCostAsset] = useState<string>('');
  const [heatmapTimeframe, setHeatmapTimeframe] = useState<string>('24h');
  const [stackedMode, setStackedMode] = useState<'usd' | 'percent'>('usd');
  const [hiddenStackedAssets, setHiddenStackedAssets] = useState<Set<string>>(() => new Set());

  const { selectedId } = usePortfolio();

  const colorFor = useCallback((asset: string): string => {
    return getAssetColor(asset);
  }, []);

  function withAlpha(hex: string, alpha: number): string {
    const h = hex.replace('#', '');
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  const assetsKey = useMemo(() => assets.join(','), [assets]);

  useEffect(() => {
    if (assets.length && !selectedAsset) {
      setSelectedAsset(assets[0]);
    }
  }, [assetsKey, assets.length, selectedAsset]);

  useEffect(() => {
    if (assets.length && !selectedPnLAsset) {
      setSelectedPnLAsset(assets[0]);
    }
  }, [assetsKey, assets.length, selectedPnLAsset]);

  useEffect(() => {
    if (assets.length && !selectedCostAsset) {
      setSelectedCostAsset(assets[0]);
    }
  }, [assetsKey, assets.length, selectedCostAsset]);

  useEffect(() => {
    const nonBtcAssets = assets.filter(a => a !== 'BTC');
    if (!nonBtcAssets.length) return;
    if (!nonBtcAssets.includes(selectedProfitAsset)) {
      setSelectedProfitAsset(nonBtcAssets.includes('ADA') ? 'ADA' : nonBtcAssets[0]);
    }
  }, [assetsKey, selectedProfitAsset]);

  const stablecoinBalanceUsd = useMemo(() => {
    let total = 0;
    for (const [asset, units] of Object.entries(holdings)) {
      const sym = asset.toUpperCase();
      if (!isStablecoin(sym)) continue;
      const qty = Number(units) || 0;
      if (qty <= 0) continue;
      const px = latestPrices[sym] || 1;
      total += qty * px;
    }
    return total;
  }, [holdings, latestPrices]);

  const hist = useMemo(() => ({ prices: historicalPrices }), [historicalPrices]);

  // Summary metrics
  const summary = useMemo(() => {
    const nf0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
    const nf2 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
    let currentValue = 0;
    let dayChange = 0;
    let dayChangePct = 0;

    if (latestPrices && Object.keys(latestPrices).length > 0) {
      for (const [a, units] of Object.entries(holdings)) {
        if (units <= 0) continue;
        let price = latestPrices[a];
        if (price === undefined || price === 0) {
          price = isStablecoin(a) ? 1.0 : 0;
        }
        currentValue += price * units;
      }
    }

    if (hist && hist.prices && hist.prices.length > 0) {
      const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
      const n = dates.length;
      if (n >= 1) {
        const prevDate = dates[n - 1];
        const prevMap = new Map<string, number>();
        for (const p of hist.prices) {
          if (p.date === prevDate) prevMap.set(p.asset.toUpperCase(), p.price_usd);
        }
        for (const [a, units] of Object.entries(holdings)) {
          if (units <= 0 || isStablecoin(a)) continue;
          const cp = latestPrices[a] || 0;
          const pp = prevMap.get(a) ?? cp;
          dayChange += (cp - pp) * units;
        }
        if (currentValue > 0) dayChangePct = (dayChange / (currentValue - dayChange)) * 100;
      }
    }

    const totalPL = pnlData.totalPnL;
    const totalPLPct = pnlData.totalPnLPercent;

      return {
      currentValue,
      dayChange,
      dayChangePct,
      totalPL,
      totalPLPct,
      formattedValue: nf0.format(currentValue),
      formattedChange: nf2.format(Math.abs(dayChange)),
      formattedPL: nf0.format(totalPL),
    };
  }, [holdings, latestPrices, hist, pnlData]);

  // Allocation data
  const allocationData = useMemo(() => {
    return Object.entries(holdings)
      .map(([asset, units]) => {
        let price = latestPrices[asset];
        if (price === undefined || price === 0) {
          price = isStablecoin(asset) ? 1.0 : 0;
        }
        return { asset, units, value: price * units };
      })
      .filter(p => p.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [holdings, latestPrices]);

  // Net worth over time - OPTIMIZED: Use dailyPos with efficient forward-fill
  const netWorthOverTime = useMemo(() => {
    const start = performance.now();
    if (!hist || !hist.prices || assets.length === 0 || !dailyPos || dailyPos.length === 0) {
      return { dates: [] as string[], cryptoExStableValue: [] as number[], stableValue: [] as number[], totalValue: [] as number[] };
    }

    // Use priceIndex.dates if available, otherwise derive from historicalPrices
    const dates = priceIndex.dates.length > 0 
      ? priceIndex.dates 
      : Array.from(new Set(hist.prices.map(p => p.date))).sort();
    
    // Build sorted positions per asset for efficient lookup
    const positionsByAsset = new Map<string, Array<{ date: string; position: number }>>();
    for (const pos of dailyPos) {
      if (!positionsByAsset.has(pos.asset)) {
        positionsByAsset.set(pos.asset, []);
      }
      positionsByAsset.get(pos.asset)!.push({ date: pos.date, position: pos.position });
    }
    
    // Sort positions by date for each asset
    for (const positions of positionsByAsset.values()) {
      positions.sort((a, b) => a.date.localeCompare(b.date));
    }

    const cryptoExStableValues: number[] = [];
    const stableValues: number[] = [];
    const totalValues: number[] = [];
    
    // Track current index per asset for binary-search-like forward-fill
    const assetIndices = new Map<string, number>();

    for (const date of dates) {
      let cryptoExStable = 0;
      let stableValue = 0;
      
      for (const asset of assets) {
        // Get position: find most recent position <= current date
        let position = 0;
        const positions = positionsByAsset.get(asset);
        if (positions && positions.length > 0) {
          // Use cached index if available, otherwise find it
          let idx = assetIndices.get(asset) ?? 0;
          
          // Advance index to find position for current date (or most recent before it)
          while (idx < positions.length - 1 && positions[idx + 1]!.date <= date) {
            idx++;
          }
          
          // If we found a position for this date or earlier, use it
          if (positions[idx]!.date <= date) {
            position = positions[idx]!.position;
            assetIndices.set(asset, idx); // Cache index for next iteration
          }
        }
        
        // Get price from priceIndex (O(1) lookup)
        let price = 0;
        const ai = priceIndex.assetIndex[asset];
        const di = priceIndex.dateIndex[date];
        if (ai !== undefined && di !== undefined && priceIndex.prices[ai] && priceIndex.prices[ai][di] !== undefined) {
          price = priceIndex.prices[ai][di];
        } else if (isStablecoin(asset)) {
          price = 1.0;
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

    const result = { dates, cryptoExStableValue: cryptoExStableValues, stableValue: stableValues, totalValue: totalValues };
    const duration = performance.now() - start;
    if (duration > 10) {
      console.log(`[Performance] netWorthOverTime: ${duration.toFixed(2)}ms`);
    }
    return result;
  }, [hist, assets, dailyPos, priceIndex]);

  const netWorthChartModel = useMemo(() => {
    const start = performance.now();
    const result = buildNetWorthLineChartModel(netWorthOverTime);
    const duration = performance.now() - start;
    if (duration > 5) {
      console.log(`[Performance] netWorthChartModel: ${duration.toFixed(2)}ms`);
    }
    return result;
  }, [netWorthOverTime]);

  // Cost vs Valuation - OPTIMIZED: Use dailyPos for portfolio value calculation
  const costVsValuation = useMemo(() => {
    const start = performance.now();
    if (!txs || txs.length === 0 || assets.length === 0 || !dailyPos || dailyPos.length === 0) {
      return { dates: [] as string[], costBasis: [] as number[], portfolioValue: [] as number[] };
    }
    const availablePrices = hist?.prices || [];
    if (availablePrices.length === 0) {
      return { dates: [] as string[], costBasis: [] as number[], portfolioValue: [] as number[] };
    }

    // Use priceIndex.dates if available, otherwise derive from historicalPrices
    const dates = priceIndex.dates.length > 0 
      ? priceIndex.dates 
      : Array.from(new Set(availablePrices.map(p => p.date))).sort();
    const costBasis: number[] = [];
    const portfolioValue: number[] = [];

    // Build positions map from dailyPos for efficient lookup
    const positionsByAsset = new Map<string, Array<{ date: string; position: number }>>();
    for (const pos of dailyPos) {
      if (!positionsByAsset.has(pos.asset)) {
        positionsByAsset.set(pos.asset, []);
      }
      positionsByAsset.get(pos.asset)!.push({ date: pos.date, position: pos.position });
    }
    
    // Sort positions by date for each asset
    for (const positions of positionsByAsset.values()) {
      positions.sort((a, b) => a.date.localeCompare(b.date));
    }

    // Process all transactions once, grouped by date
    // This ensures each transaction is only processed once
    const txsByDate = new Map<string, typeof txs>();
    for (const tx of txs) {
      const txDate = new Date(tx.datetime).toISOString().slice(0, 10);
      const arr = txsByDate.get(txDate) || [];
      arr.push(tx);
      txsByDate.set(txDate, arr);
    }

    let cumulativeCost = 0;
    const processedTxIds = new Set<number>();
    const assetIndices = new Map<string, number>();

    for (const date of dates) {
      // Only process transactions that occurred on this specific date
      const txsForDate = txsByDate.get(date) || [];
      
      for (const tx of txsForDate) {
        // Skip if already processed (safety check)
        if (processedTxIds.has(tx.id)) continue;
        processedTxIds.add(tx.id);

        if (tx.type === 'Deposit') {
          // For deposits: cost basis is the USD value of what was deposited
          // For fiat deposits, toQuantity is in the fiat currency, toPriceUsd is the FX rate to USD
          // For crypto deposits, toQuantity is in crypto units, toPriceUsd is the crypto price in USD
          let depositValueUsd = 0;
          if (tx.toPriceUsd) {
            depositValueUsd = tx.toQuantity * tx.toPriceUsd;
          } else {
            // Try to get FX rate for the deposit date
            const fxRate = fxRateMap.get(date);
            if (fxRate && tx.toAsset) {
              const fromCurrency = tx.toAsset.toUpperCase();
              const rate = fxRate[fromCurrency] || 1;
              depositValueUsd = tx.toQuantity * rate;
            } else {
              // Fallback: use latest price or assume 1:1 for stablecoins
              depositValueUsd = tx.toQuantity * (latestPrices[tx.toAsset] || (isStablecoin(tx.toAsset) ? 1 : 0));
            }
          }
          cumulativeCost += depositValueUsd;
        } else if (tx.type === 'Withdrawal') {
          // For withdrawals: cost basis reduction is the USD value withdrawn
          // fromAsset is the asset being withdrawn (usually stablecoin/fiat)
          let withdrawalValueUsd = 0;
          if (tx.fromQuantity && tx.fromPriceUsd) {
            withdrawalValueUsd = tx.fromQuantity * tx.fromPriceUsd;
          } else if (tx.toQuantity && tx.toPriceUsd) {
            withdrawalValueUsd = tx.toQuantity * tx.toPriceUsd;
          } else {
            // Try FX rate
            const fxRate = fxRateMap.get(date);
            if (fxRate && tx.fromAsset) {
              const fromCurrency = tx.fromAsset.toUpperCase();
              const rate = fxRate[fromCurrency] || 1;
              withdrawalValueUsd = (tx.fromQuantity || tx.toQuantity || 0) * rate;
            } else {
              const asset = tx.fromAsset || tx.toAsset || '';
              withdrawalValueUsd = (tx.fromQuantity || tx.toQuantity || 0) * (latestPrices[asset] || (isStablecoin(asset) ? 1 : 0));
            }
          }
          cumulativeCost -= withdrawalValueUsd;
        }
      }

      let portfolioVal = 0;
      // Use dailyPos instead of filtering transactions - much faster!
      for (const asset of assets) {
        // Get position from dailyPos using forward-fill
        let position = 0;
        const positions = positionsByAsset.get(asset);
        if (positions && positions.length > 0) {
          let idx = assetIndices.get(asset) ?? 0;
          while (idx < positions.length - 1 && positions[idx + 1]!.date <= date) {
            idx++;
          }
          if (positions[idx]!.date <= date) {
            position = positions[idx]!.position;
            assetIndices.set(asset, idx);
          }
        }

        // Calculate portfolio value using position and price
        let px = 0;
        // Try priceIndex first
        const ai = priceIndex.assetIndex[asset];
        const di = priceIndex.dateIndex[date];
        if (ai !== undefined && di !== undefined && priceIndex.prices[ai] && priceIndex.prices[ai][di] !== undefined) {
          px = priceIndex.prices[ai][di];
        } else if (isStablecoin(asset)) {
          px = 1.0;
        }
        if (px > 0 && position > 0) {
          portfolioVal += position * px;
        }
      }

      costBasis.push(cumulativeCost);
      portfolioValue.push(portfolioVal);
    }

    const result = { dates, costBasis, portfolioValue };
    const duration = performance.now() - start;
    if (duration > 10) {
      console.log(`[Performance] costVsValuation: ${duration.toFixed(2)}ms (${dates.length} dates)`);
    }
    return result;
  }, [hist, txs, assets, priceIndex, fxRateMap, latestPrices]);

  // Stacked portfolio value
  const stackedTraces = useMemo(() => {
    const start = performance.now();
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

    const result = { usd, percent, dateIndex };
    const duration = performance.now() - start;
    if (duration > 10) {
      console.log(`[Performance] stackedTraces: ${duration.toFixed(2)}ms (${dates.length} dates, ${assets.length} assets)`);
    }
    return result;
  }, [stacked, assets, colorFor, hiddenStackedAssets]);

  // Custom hover tooltip - shows only assets with holdings > 0 at the hovered timestamp
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
    if (!stackedHoverDate || !stacked.dates.length) return null;
    const di = stackedTraces.dateIndex.get(stackedHoverDate);
    if (di === undefined) return null;
    const total = stacked.totals[di] || 0;
    if (total <= 0) return null;

    // Only show assets with holdings > 0 at this timestamp
    const items: Array<{ asset: string; value: number }> = [];
    for (const a of assets) {
      if (hiddenStackedAssets.has(a)) continue;
      const yUsd = stacked.perAssetUsd.get(a);
      const v = yUsd ? (yUsd[di] || 0) : 0;
      // Only include if value > 0
      if (v > 0) {
        items.push({ asset: a, value: stackedMode === 'percent' ? (v / total) * 100 : v });
      }
    }
    // Sort by value descending
    items.sort((x, y) => y.value - x.value);
    
    return { date: stackedHoverDate, total, items };
  }, [stackedHoverDate, stackedTraces.dateIndex, stacked.totals, stacked.perAssetUsd, assets, stackedMode, hiddenStackedAssets]);

  const handleStackedLegendClick = useCallback((evt: unknown) => {
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
    return false;
  }, []);

  const handleStackedLegendDoubleClick = useCallback((evt: unknown) => {
    const e = evt as { curveNumber?: number; data?: Array<{ name?: string }> } | null;
    const curve = e?.curveNumber;
    const name = (typeof curve === 'number' ? e?.data?.[curve]?.name : undefined) ?? undefined;
    if (!name) return false;
    setHiddenStackedAssets((prev) => {
      const all = new Set<string>(assets);
      const othersHidden = Array.from(all).filter((a) => a !== name).every((a) => prev.has(a));
      if (othersHidden && !prev.has(name)) return new Set();
      const next = new Set<string>();
      for (const a of all) if (a !== name) next.add(a);
      return next;
    });
    return false;
  }, [assets]);

  // PnL calculation
  const pnl = useMemo(() => {
    const start = performance.now();
    if (!hist || !hist.prices || assets.length === 0 || !txs || txs.length === 0 || !selectedPnLAsset) {
      return { dates: [] as string[], realized: [] as number[], unrealized: [] as number[] };
    }
    const priceMap = new Map<string, number>();
    for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);

    const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
    const filteredTxs = txs
      .filter(t => {
        if (t.type === 'Swap') {
          return t.toAsset.toUpperCase() === selectedPnLAsset || t.fromAsset?.toUpperCase() === selectedPnLAsset;
        }
        return false;
      })
      .filter(t => {
        return ![...STABLECOINS, 'USD'].includes(selectedPnLAsset);
      });

    type TxEnriched = { asset: string; type: 'Buy' | 'Sell'; units: number; unitPrice: number };
      const txByDate = new Map<string, TxEnriched[]>();
    for (const t of filteredTxs) {
      if (t.type !== 'Swap') continue;
        const day = new Date(new Date(t.datetime).getFullYear(), new Date(t.datetime).getMonth(), new Date(t.datetime).getDate()).toISOString().slice(0, 10);
        const key = day;
        const arr = txByDate.get(key) || [];

      if (t.toAsset.toUpperCase() === selectedPnLAsset) {
        const asset = t.toAsset.toUpperCase();
        const units = Math.abs(t.toQuantity);
        const unitPrice = t.toPriceUsd || priceMap.get(day + '|' + asset) || 0;
        arr.push({ asset, type: 'Buy' as const, units, unitPrice });
      } else if (t.fromAsset?.toUpperCase() === selectedPnLAsset) {
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
          if (tx.type === 'Buy') {
          heldUnits.set(tx.asset, (heldUnits.get(tx.asset) || 0) + tx.units);
          heldCost.set(tx.asset, (heldCost.get(tx.asset) || 0) + tx.units * tx.unitPrice);
          } else {
          const units = heldUnits.get(tx.asset) || 0;
          const cost = heldCost.get(tx.asset) || 0;
          const avgCost = units > 0 ? cost / units : 0;
          const qty = Math.min(tx.units, units);
          const salePrice = tx.unitPrice;
          const profit = (salePrice - avgCost) * qty;
          realizedCum += profit;
          heldUnits.set(tx.asset, units - qty);
          heldCost.set(tx.asset, cost - avgCost * qty);
        }
      }

      const currentPrice = priceMap.get(d + '|' + selectedPnLAsset) || 0;
      let unrealized = 0;
      for (const [asset, units] of heldUnits.entries()) {
        if (units > 0 && asset === selectedPnLAsset) {
          const cost = heldCost.get(asset) || 0;
          const avgCost = units > 0 ? cost / units : 0;
          unrealized += (currentPrice - avgCost) * units;
        }
      }

      realizedSeries.push(realizedCum);
      unrealizedSeries.push(unrealized);
    }

    const result = { dates, realized: realizedSeries, unrealized: unrealizedSeries };
    const duration = performance.now() - start;
    if (duration > 10) {
      console.log(`[Performance] pnl: ${duration.toFixed(2)}ms (${dates.length} dates)`);
    }
    return result;
  }, [hist, txs, selectedPnLAsset, assets]);

  // Cost vs Price for selected asset
  const costVsPrice = useMemo(() => {
    const start = performance.now();
    if (!hist || !hist.prices || !selectedCostAsset) return { dates: [] as string[], avgCost: [] as number[], price: [] as number[] };
    const asset = selectedCostAsset.toUpperCase();
    const dates = Array.from(new Set(hist.prices.filter(p => p.asset.toUpperCase() === asset).map(p => p.date))).sort();
    const txsA = (txs || []).filter(t => {
      if (t.type === 'Swap') {
        return t.toAsset.toUpperCase() === asset || t.fromAsset?.toUpperCase() === asset;
      }
      return false;
    }).map(t => {
      const date = new Date(new Date(t.datetime).getFullYear(), new Date(t.datetime).getMonth(), new Date(t.datetime).getDate()).toISOString().slice(0, 10);
      if (t.toAsset.toUpperCase() === asset) {
        return { date, type: 'Buy' as const, units: Math.abs(t.toQuantity), unitPrice: t.toPriceUsd || 0 };
      } else {
        return { date, type: 'Sell' as const, units: Math.abs(t.fromQuantity || 0), unitPrice: t.fromPriceUsd || 0 };
      }
    });
    const txByDate = new Map<string, { type: 'Buy' | 'Sell'; units: number; unitPrice: number }[]>();
    for (const tx of txsA) { const arr = txByDate.get(tx.date) || []; arr.push(tx); txByDate.set(tx.date, arr); }
    let units = 0; let costVal = 0;
    const avgCost: number[] = [];
    const price: number[] = [];
    const priceMap = new Map<string, number>();
    for (const p of hist.prices.filter(p => p.asset.toUpperCase() === asset)) priceMap.set(p.date, p.price_usd);
    for (const d of dates) {
      const todays = txByDate.get(d) || [];
      for (const tx of todays) {
        if (tx.type === 'Buy') { units += tx.units; costVal += tx.units * tx.unitPrice; }
        else {
          const avg = units > 0 ? costVal / units : 0; const qty = Math.min(tx.units, units);
          costVal -= avg * qty; units -= qty;
        }
      }
      const avg = units > 0 ? costVal / units : 0;
      avgCost.push(Number(avg.toFixed(6)));
      price.push(priceMap.get(d) || 0);
    }
    const result = { dates, avgCost, price };
    const duration = performance.now() - start;
    if (duration > 10) {
      console.log(`[Performance] costVsPrice: ${duration.toFixed(2)}ms (${dates.length} dates)`);
    }
    return result;
  }, [hist, txs, selectedCostAsset]);

  // Position charts
  const positionsFigure = useMemo(() => {
    const start = performance.now();
    const groups = new Map<string, { x: string[]; y: number[] }>();
    for (const r of dailyPos) {
      const g = groups.get(r.asset) || { x: [], y: [] };
      g.x.push(r.date); g.y.push(r.position);
      groups.set(r.asset, g);
    }

    const data: Data[] = ((() => {
      if (selectedAsset && groups.has(selectedAsset)) {
        const g = groups.get(selectedAsset)!;
        const text = g.x.map(d => notesByDayAsset.get(`${d}|${selectedAsset}`) || '');
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
      return Array.from(groups.entries()).map(([asset, g]) => {
        const text = g.x.map(d => notesByDayAsset.get(`${d}|${asset}`) || '');
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
    const layout: Partial<Layout> = { autosize: true, height: 320, margin: { t: 30, r: 10, l: 40, b: 40 }, legend: { orientation: 'h' } };
    const result = { data, layout };
    const duration = performance.now() - start;
    if (duration > 10) {
      console.log(`[Performance] positionsFigure: ${duration.toFixed(2)}ms (${data.length} traces)`);
    }
    return result;
  }, [dailyPos, selectedAsset, colorFor, notesByDayAsset]);

  // BTC Ratio & Accumulation
  const btcRatio = useMemo(() => {
    const start = performance.now();
    if (!hist || !hist.prices || assets.length === 0 || !txs || txs.length === 0) {
      return { dates: [] as string[], btcValue: [] as number[], btcPercentage: [] as number[] };
    }

    const priceMap = new Map<string, number>();
    for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);

    const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
    const txsByDate = new Map<string, { asset: string; type: 'Buy' | 'Sell'; qty: number }[]>();
    for (const t of txs) {
      const day = new Date(t.datetime).toISOString().slice(0, 10);
      const arr = txsByDate.get(day) || [];

      if (t.type === 'Swap') {
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
        const toA = t.toAsset.toUpperCase();
        if (toA !== 'USD') {
          arr.push({ asset: toA, type: 'Buy' as const, qty: Math.abs(t.toQuantity) });
        }
      } else if (t.type === 'Withdrawal') {
        const fromA = t.fromAsset?.toUpperCase();
        if (fromA && fromA !== 'USD') {
          arr.push({ asset: fromA, type: 'Sell' as const, qty: Math.abs(t.fromQuantity || 0) });
        }
      }
      txsByDate.set(day, arr);
    }

    const currentHoldings: Record<string, number> = {};
    for (const a of assets) currentHoldings[a] = currentHoldings[a] || 0;

    const btcValue: number[] = [];
    const btcPercentage: number[] = [];

    for (const date of dates) {
      const todays = txsByDate.get(date) || [];
        for (const tx of todays) {
          if (tx.type === 'Buy') {
            currentHoldings[tx.asset] = (currentHoldings[tx.asset] || 0) + tx.qty;
          } else {
          currentHoldings[tx.asset] = Math.max(0, (currentHoldings[tx.asset] || 0) - tx.qty);
        }
      }

      let totalValueUsd = 0;
      let btcValueUsd = 0;
      const btcPrice = priceMap.get(date + '|BTC') || 0;

      for (const [asset, qty] of Object.entries(currentHoldings)) {
        if (qty <= 0) continue;
        const price = priceMap.get(date + '|' + asset) || (isStablecoin(asset) ? 1.0 : 0);
        const value = qty * price;
        totalValueUsd += value;
        if (asset === 'BTC') btcValueUsd += value;
      }

      const btcVal = btcPrice > 0 ? totalValueUsd / btcPrice : 0;
      btcValue.push(btcVal);
      btcPercentage.push(totalValueUsd > 0 ? (btcValueUsd / totalValueUsd) * 100 : 0);
    }

    const result = { dates, btcValue, btcPercentage };
    const duration = performance.now() - start;
    if (duration > 10) {
      console.log(`[Performance] btcRatio: ${duration.toFixed(2)}ms (${dates.length} dates)`);
    }
    return result;
  }, [hist, assets, txs]);

  // Altcoin Holdings BTC Value - OPTIMIZED: Use dailyPos instead of filtering transactions
  const altcoinVsBtc = useMemo(() => {
    const start = performance.now();
    if (!hist || !hist.prices || assets.length === 0 || !dailyPos || dailyPos.length === 0) {
      return { dates: [] as string[], performance: {} as Record<string, number[]> };
    }
    
    const priceMap = new Map<string, number>();
    for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);
    
    // Use priceIndex.dates if available, otherwise derive from historicalPrices
    const dates = priceIndex.dates.length > 0 
      ? priceIndex.dates 
      : Array.from(new Set(hist.prices.map(p => p.date))).sort();
    
    // Build position map from dailyPos with forward-fill
    const positionMap = new Map<string, number>();
    const positionsByAsset = new Map<string, Array<{ date: string; position: number }>>();
    for (const pos of dailyPos) {
      if (!positionsByAsset.has(pos.asset)) {
        positionsByAsset.set(pos.asset, []);
      }
      positionsByAsset.get(pos.asset)!.push({ date: pos.date, position: pos.position });
    }
    
    // Sort positions by date for each asset
    for (const positions of positionsByAsset.values()) {
      positions.sort((a, b) => a.date.localeCompare(b.date));
    }
    
    const performanceData: Record<string, number[]> = {};
    const assetIndices = new Map<string, number>();
    
    for (const asset of assets) {
      if (asset === 'BTC') continue;
      const btcValues: number[] = [];
      const positions = positionsByAsset.get(asset);
      
      for (const date of dates) {
        // Get position: find most recent position <= current date
        let position = 0;
        if (positions && positions.length > 0) {
          let idx = assetIndices.get(asset) ?? 0;
          while (idx < positions.length - 1 && positions[idx + 1]!.date <= date) {
            idx++;
          }
          if (positions[idx]!.date <= date) {
            position = positions[idx]!.position;
            assetIndices.set(asset, idx);
          }
        }

        const assetPrice = priceMap.get(date + '|' + asset) || 0;
        const btcPrice = priceMap.get(date + '|BTC') || 0;
        const valueUsd = position * assetPrice;
        const btcValue = btcPrice > 0 ? valueUsd / btcPrice : 0;
        btcValues.push(btcValue);
      }

      performanceData[asset] = btcValues;
    }
    
    const result = { dates, performance: performanceData };
    const duration = performance.now() - start;
    if (duration > 10) {
      console.log(`[Performance] altcoinVsBtc: ${duration.toFixed(2)}ms (${dates.length} dates, ${Object.keys(performanceData).length} assets)`);
    }
    return result;
  }, [hist, assets, dailyPos, priceIndex]);

  // Profit-Taking Opportunities - OPTIMIZED: Process transactions once, grouped by date
  const profitOpportunities = useMemo(() => {
    const start = performance.now();
    if (!hist || !hist.prices || assets.length === 0 || !txs || txs.length === 0 || !dailyPos || dailyPos.length === 0) {
      return { dates: [] as string[], opportunities: {} as Record<string, { altcoinPnL: number[]; btcPnL: number[] }> };
    }
    
    const priceMap = new Map<string, number>();
    for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);
    
    // Use priceIndex.dates if available, otherwise derive from historicalPrices
    const dates = priceIndex.dates.length > 0 
      ? priceIndex.dates 
      : Array.from(new Set(hist.prices.map(p => p.date))).sort();
    
    // Group transactions by date for efficient processing
    const txsByDate = new Map<string, typeof txs>();
    for (const tx of txs) {
      const txDate = new Date(tx.datetime).toISOString().slice(0, 10);
      const arr = txsByDate.get(txDate) || [];
      arr.push(tx);
      txsByDate.set(txDate, arr);
    }
    
    // Build position map from dailyPos for quick position lookup
    const positionsByAsset = new Map<string, Array<{ date: string; position: number }>>();
    for (const pos of dailyPos) {
      if (!positionsByAsset.has(pos.asset)) {
        positionsByAsset.set(pos.asset, []);
      }
      positionsByAsset.get(pos.asset)!.push({ date: pos.date, position: pos.position });
    }
    
    // Sort positions by date for each asset
    for (const positions of positionsByAsset.values()) {
      positions.sort((a, b) => a.date.localeCompare(b.date));
    }
    
    const opportunities: Record<string, { altcoinPnL: number[]; btcPnL: number[] }> = {};
    const assetIndices = new Map<string, number>();
    
    for (const asset of assets) {
      if (asset === 'BTC') continue;
      
      const altcoinPnL: number[] = [];
      const btcPnL: number[] = [];
      
      // Track cost basis and BTC equivalent over time
        let totalQuantity = 0;
        let totalCostUsd = 0;
      let totalBtcQuantity = 0;
      let totalBtcCostUsd = 0;
      
      const positions = positionsByAsset.get(asset);
      let positionIdx = 0;
      
      for (const date of dates) {
        // Process transactions for this date (only once per date)
        const txsForDate = txsByDate.get(date) || [];
        for (const tx of txsForDate) {
          if (tx.type === 'Swap') {
            if (tx.toAsset.toUpperCase() === asset) {
              const quantity = Math.abs(tx.toQuantity);
            totalQuantity += quantity;
              const costUsd = quantity * (tx.toPriceUsd || 0);
              totalCostUsd += costUsd;
              
              // Track BTC equivalent
              const btcPriceAtTx = priceMap.get(date + '|BTC') || priceMap.get(dates[dates.length - 1]! + '|BTC') || 0;
              if (btcPriceAtTx > 0) {
                const btcQty = costUsd / btcPriceAtTx;
                totalBtcQuantity += btcQty;
                totalBtcCostUsd += costUsd;
              }
            } else if (tx.fromAsset?.toUpperCase() === asset) {
              const quantity = Math.abs(tx.fromQuantity || 0);
            if (totalQuantity > 0) {
              const currentAvgCost = totalCostUsd / totalQuantity;
              const unitsToSell = Math.min(quantity, totalQuantity);
              totalCostUsd -= unitsToSell * currentAvgCost;
              totalQuantity -= unitsToSell;
                
                // Track BTC equivalent sell
              if (totalBtcQuantity > 0) {
                const currentAvgBtcCost = totalBtcCostUsd / totalBtcQuantity;
                  const btcPriceAtTx = priceMap.get(date + '|BTC') || priceMap.get(dates[dates.length - 1]! + '|BTC') || 0;
                  if (btcPriceAtTx > 0) {
                    const costUsd = quantity * (tx.fromPriceUsd || currentAvgCost);
                const btcQuantityToSell = costUsd / btcPriceAtTx;
                    const unitsToSellBtc = Math.min(btcQuantityToSell, totalBtcQuantity);
                    totalBtcCostUsd -= unitsToSellBtc * currentAvgBtcCost;
                    totalBtcQuantity -= unitsToSellBtc;
                  }
                }
              }
            }
          } else if (tx.type === 'Deposit' && tx.toAsset.toUpperCase() === asset) {
            const quantity = Math.abs(tx.toQuantity);
            totalQuantity += quantity;
            const costUsd = quantity * (tx.toPriceUsd || 1);
            totalCostUsd += costUsd;
            
            // Track BTC equivalent
            const btcPriceAtTx = priceMap.get(date + '|BTC') || priceMap.get(dates[dates.length - 1]! + '|BTC') || 0;
            if (btcPriceAtTx > 0) {
              const btcQty = costUsd / btcPriceAtTx;
              totalBtcQuantity += btcQty;
              totalBtcCostUsd += costUsd;
            }
          }
        }
        
        // Get current position from dailyPos (for validation)
        let currentPosition = 0;
        if (positions && positions.length > 0) {
          while (positionIdx < positions.length - 1 && positions[positionIdx + 1]!.date <= date) {
            positionIdx++;
          }
          if (positions[positionIdx]!.date <= date) {
            currentPosition = positions[positionIdx]!.position;
          }
        }
        
        // Only calculate PnL if we have a position
        if (currentPosition > 0 || totalQuantity > 0) {
          const currentPrice = priceMap.get(date + '|' + asset) || 0;
          const currentBtcPrice = priceMap.get(date + '|BTC') || 0;
          const currentValueUsd = totalQuantity * currentPrice;
          const altcoinPnLValue = currentValueUsd - totalCostUsd;
          altcoinPnL.push(altcoinPnLValue);
          
          let btcPnLValue = 0;
          if (totalBtcQuantity > 0 && totalBtcCostUsd > 0 && currentBtcPrice > 0) {
            const currentBtcValueUsd = totalBtcQuantity * currentBtcPrice;
            btcPnLValue = currentBtcValueUsd - totalBtcCostUsd;
          }
          btcPnL.push(btcPnLValue);
        } else {
          altcoinPnL.push(0);
          btcPnL.push(0);
        }
      }
      
      opportunities[asset] = { altcoinPnL, btcPnL };
    }
    
    const result = { dates, opportunities };
    const duration = performance.now() - start;
    if (duration > 10) {
      console.log(`[Performance] profitOpportunities: ${duration.toFixed(2)}ms (${dates.length} dates, ${Object.keys(opportunities).length} assets)`);
    }
    return result;
  }, [hist, assets, txs, dailyPos, priceIndex]);

  // Portfolio Heatmap
  const portfolioHeatmap = useMemo(() => {
    const start = performance.now();
    if (!txs || txs.length === 0 || !assets.length) {
      return { assets: [] as string[], pnlValues: [] as number[], colors: [] as string[] };
    }

    const grouped: Record<string, typeof txs> = {};
    for (const t of txs) {
      const assetList: string[] = [];
      if (t.fromAsset) assetList.push(t.fromAsset.toUpperCase());
      if (t.toAsset) assetList.push(t.toAsset.toUpperCase());
      for (const a of assetList) {
      (grouped[a] ||= []).push(t);
      }
    }

    const heatmapData: { asset: string; pnl: number; color: string }[] = [];

    let referencePriceMap: Map<string, number> | null = null;
    if (heatmapTimeframe !== 'current' && hist && hist.prices && hist.prices.length > 0) {
      const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
      const n = dates.length;
      if (n >= 2) {
        let targetDateIndex = n - 2;
        if (heatmapTimeframe === '7d' || heatmapTimeframe === '30d') {
          const daysBack = heatmapTimeframe === '7d' ? 7 : 30;
          const targetDate = new Date();
          targetDate.setDate(targetDate.getDate() - daysBack);
          const targetDateStr = targetDate.toISOString().slice(0, 10);
          for (let i = dates.length - 1; i >= 0; i--) {
            if (dates[i]! <= targetDateStr) {
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
      if (heatmapTimeframe !== 'current' && isStablecoin(asset)) continue;
      
      const arr = grouped[asset] || [];
      let totalQuantity = 0;
      let totalCostUsd = 0;
      for (const tx of arr) {
        if (tx.type === 'Swap') {
          if (tx.toAsset.toUpperCase() === asset) {
            const quantity = Math.abs(tx.toQuantity);
          totalQuantity += quantity;
            totalCostUsd += quantity * (tx.toPriceUsd || 0);
          } else if (tx.fromAsset?.toUpperCase() === asset) {
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

      if (totalQuantity <= 0) continue;

      let pnl: number;
      if (heatmapTimeframe === 'current') {
        const currentPrice = latestPrices[asset] || 0;
        const currentValueUsd = totalQuantity * currentPrice;
        pnl = currentValueUsd - totalCostUsd;
      } else {
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

    const result = {
      assets: heatmapData.map(d => d.asset),
      pnlValues: heatmapData.map(d => d.pnl),
      colors: heatmapData.map(d => d.color),
    };
    const duration = performance.now() - start;
    if (duration > 10) {
      console.log(`[Performance] portfolioHeatmap: ${duration.toFixed(2)}ms (${result.assets.length} assets)`);
    }
    return result;
  }, [txs, assets, hist, latestPrices, heatmapTimeframe]);

  const isLoading = loadingTxs || loadingCurr || loadingHist;

  return (
    <AuthGuard>
      <main className="dashboard-container">
        {/* Summary Cards */}
        <div className="dashboard-summary">
          <div className="summary-card primary">
            <div className="summary-label">Portfolio Value</div>
            <div className="summary-value">
              {isLoading ? (
                <div className="skeleton-text" style={{ width: '120px', height: '32px' }} />
              ) : (
                <>${summary.formattedValue}</>
              )}
        </div>
            {!isLoading && (
              <div className={`summary-change ${summary.dayChange >= 0 ? 'positive' : 'negative'}`}>
                {summary.dayChange >= 0 ? '↑' : '↓'} ${summary.formattedChange} ({summary.dayChangePct >= 0 ? '+' : ''}{summary.dayChangePct.toFixed(2)}%)
        </div>
            )}
        </div>

          <div className="summary-card">
            <div className="summary-label">Total P&L</div>
            <div className={`summary-value ${summary.totalPL >= 0 ? 'positive' : 'negative'}`}>
              {isLoading ? (
                <div className="skeleton-text" style={{ width: '100px', height: '28px' }} />
              ) : (
                <>${summary.formattedPL}</>
              )}
        </div>
            {!isLoading && summary.totalPLPct !== undefined && (
              <div className="summary-subtext">
                {summary.totalPLPct >= 0 ? '+' : ''}{summary.totalPLPct.toFixed(2)}%
        </div>
            )}
      </div>

          <div className="summary-card">
            <div className="summary-label">Assets</div>
            <div className="summary-value">
              {isLoading ? (
                <div className="skeleton-text" style={{ width: '60px', height: '28px' }} />
              ) : (
                <>{assets.length}</>
              )}
          </div>
            <div className="summary-subtext">{allocationData.length} active</div>
            </div>
          </div>

        {/* Main Charts Grid */}
        <div className="dashboard-grid">
          {/* Net Worth Chart */}
          <ChartCard title="Net Worth Over Time" defaultTimeframe="1y">
            {({ timeframe, expanded }) => {
              if (isLoading) {
                return <div className="chart-loading">Loading net worth data...</div>;
              }
              if (!netWorthOverTime.dates.length) {
                return <div className="chart-empty">No net worth data available</div>;
              }
              const idx = sliceStartIndexForIsoDates(netWorthOverTime.dates, timeframe);
              // Slice the dates array first, then use it to slice the series
              const slicedDates = netWorthOverTime.dates.slice(idx);
              const slicedSeries = netWorthChartModel.series.map(s => ({
                ...s,
                y: s.y.slice(idx),
              }));
              
              // Sample data points for performance (max 100 points)
              const maxPoints = expanded ? 200 : 100;
              if (slicedDates.length > maxPoints) {
                const dataArrays = slicedSeries.map(s => s.y);
                const sampled = sampleDataPoints(slicedDates, dataArrays, maxPoints);
                const sampledModel = {
                  ...netWorthChartModel,
                  x: sampled.dates,
                  series: slicedSeries.map((s, i) => ({
                    ...s,
                    y: sampled.dataArrays[i]!,
                  })),
                };
                return <LineChart model={sampledModel} />;
              }
              
              const slicedModel = {
                ...netWorthChartModel,
                x: slicedDates,
                series: slicedSeries,
              };
              return (
                <LineChart
                  model={slicedModel}
                />
              );
            }}
        </ChartCard>

          {/* Allocation Chart */}
          <ChartCard title="Portfolio Allocation" timeframeEnabled={false}>
          {({ timeframe, expanded }) => {
              if (isLoading) {
                return <div className="chart-loading">Loading allocation...</div>;
              }
              return (
            <AllocationPieChart 
              data={allocationData}
              isLoading={isLoading}
              height={expanded ? 500 : 320}
            />
              );
          }}
        </ChartCard>

      {/* Portfolio Gains/Losses Heatmap */}
          <ChartCard
            title="Portfolio Gains/Losses Heatmap"
            timeframeEnabled={false}
            infoText={`Portfolio Gains/Losses Heatmap

This heatmap shows the profit and loss (PnL) for each asset in your portfolio.

• Block size represents the magnitude of gains/losses
• Green blocks = positive PnL (profits)
• Red blocks = negative PnL (losses)
• Larger blocks = bigger gains or losses

Timeframe options:
• 24h/7d/30d: PnL change over the specified period`}
            headerActions={() => (
              <div className="segmented" style={{ display: 'flex', gap: '4px' }}>
                <button
                  type="button"
                  className={heatmapTimeframe === '24h' ? 'active' : ''}
                  onClick={() => setHeatmapTimeframe('24h')}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: heatmapTimeframe === '24h' ? '2px solid var(--primary)' : '1px solid var(--border)',
                    background: heatmapTimeframe === '24h' ? 'var(--primary)' : 'var(--surface)',
                    color: heatmapTimeframe === '24h' ? '#fff' : 'var(--text)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    transition: 'all 0.2s',
                  }}
                >
                  24h
                </button>
                <button
                  type="button"
                  className={heatmapTimeframe === '7d' ? 'active' : ''}
                  onClick={() => setHeatmapTimeframe('7d')}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: heatmapTimeframe === '7d' ? '2px solid var(--primary)' : '1px solid var(--border)',
                    background: heatmapTimeframe === '7d' ? 'var(--primary)' : 'var(--surface)',
                    color: heatmapTimeframe === '7d' ? '#fff' : 'var(--text)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    transition: 'all 0.2s',
                  }}
                >
                  7d
                </button>
                <button
                  type="button"
                  className={heatmapTimeframe === '30d' ? 'active' : ''}
                  onClick={() => setHeatmapTimeframe('30d')}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '8px',
                    border: heatmapTimeframe === '30d' ? '2px solid var(--primary)' : '1px solid var(--border)',
                    background: heatmapTimeframe === '30d' ? 'var(--primary)' : 'var(--surface)',
                    color: heatmapTimeframe === '30d' ? '#fff' : 'var(--text)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    transition: 'all 0.2s',
                  }}
                >
                  30d
            </button>
          </div>
            )}
          >
            {({ timeframe, expanded }) => {
              if (loadingTxs || !txs) {
                return <div className="chart-loading">Loading heatmap...</div>;
              }
              if (!portfolioHeatmap.assets.length) {
                return <div className="chart-empty">No heatmap data</div>;
              }

              return (
        <Plot
          data={[
            {
              type: 'treemap',
              labels: portfolioHeatmap.assets,
              parents: portfolioHeatmap.assets.map(() => ''),
              values: portfolioHeatmap.pnlValues.map(Math.abs),
              text: portfolioHeatmap.assets.map((asset, i) => 
                        `${asset}<br>${portfolioHeatmap.pnlValues[i]! >= 0 ? '+' : ''}${portfolioHeatmap.pnlValues[i]!.toLocaleString('en-US', { 
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
                    height: expanded ? undefined : 400,
                    margin: { t: 30, r: 10, l: 10, b: 10 },
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                  }}
                  style={{ width: '100%', height: expanded ? '100%' : undefined }}
                />
              );
          }}
        </ChartCard>

          {/* Cost Basis vs Valuation */}
          <ChartCard title="Cost Basis vs Portfolio Valuation">
          {({ timeframe, expanded }) => {
              if (loadingTxs || !txs) {
                return <div className="chart-loading">Loading cost vs valuation data...</div>;
              }
              if (!costVsValuation.dates.length) {
                return <div className="chart-empty">No cost vs valuation data</div>;
              }
            const idx = sliceStartIndexForIsoDates(costVsValuation.dates, timeframe);
              const dates = costVsValuation.dates.slice(idx);
              const costBasis = costVsValuation.costBasis.slice(idx);
              const portfolioValue = costVsValuation.portfolioValue.slice(idx);
              
              // Sample data points for performance (max 100 points)
              const maxPoints = expanded ? 200 : 100;
              const sampled = sampleDataPoints(dates, [costBasis, portfolioValue], maxPoints);
              
            return (
              <Plot
                data={[
                  {
                      x: sampled.dates,
                      y: sampled.dataArrays[0]!,
                    type: 'scatter',
                    mode: 'lines',
                      name: 'Cost Basis',
                      line: { color: '#5b8cff', width: 2 },
                    },
                    {
                      x: sampled.dates,
                      y: sampled.dataArrays[1]!,
                    type: 'scatter',
                    mode: 'lines',
                      name: 'Portfolio Value',
                      line: { color: '#16a34a', width: 2 },
                  },
                ] as Data[]}
                layout={{
                    autosize: true,
                    height: expanded ? undefined : 320,
                    margin: { t: 30, r: 10, l: 40, b: 40 },
                    legend: { orientation: 'h' },
                  hovermode: 'x unified',
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                }}
                style={{ width: '100%', height: expanded ? '100%' : undefined }}
              />
            );
          }}
        </ChartCard>

          {/* Stacked Portfolio Value */}
        <ChartCard
            title="Portfolio Composition Over Time"
          headerActions={() => (
              <label className="chart-control">
                <select value={stackedMode} onChange={e => setStackedMode(e.target.value as 'usd' | 'percent')}>
              <option value="usd">USD</option>
                  <option value="percent">%</option>
            </select>
          </label>
        )}
      >
        {({ timeframe, expanded }) => {
              if (loadingTxs || !txs) {
                return <div className="chart-loading">Loading portfolio composition...</div>;
              }
              if (!stacked.dates.length) {
                // Debug info
                console.log('[Stacked Chart] No dates:', {
                  stackedDates: stacked.dates.length,
                  historicalPrices: historicalPrices?.length || 0,
                  dailyPos: dailyPos?.length || 0,
                  loadingHist,
                  loadingTxs,
                });
                return <div className="chart-empty">No composition data (prices: {historicalPrices?.length || 0}, positions: {dailyPos?.length || 0})</div>;
              }
          const idx = sliceStartIndexForIsoDates(stacked.dates, timeframe);
              const slicedDates = stacked.dates.slice(idx);
              const slicedSeries = (stackedMode === 'usd' ? stackedTraces.usd : stackedTraces.percent).map(tr => {
                const trace = tr as { x?: string[]; y?: number[]; [key: string]: unknown };
                return {
                  ...tr,
                  x: trace.x ? trace.x.slice(idx) : [],
                  y: trace.y ? trace.y.slice(idx) : [],
                } as unknown as Data;
          });
              
              // Sample data points for performance (max 100 points for stacked charts)
              const maxPoints = expanded ? 200 : 100;
              if (slicedDates.length > maxPoints && slicedSeries.length > 0) {
                const dataArrays = slicedSeries.map(tr => {
                  const t = tr as { y?: number[] };
                  return t.y || [];
                });
                const sampled = sampleDataPoints(slicedDates, dataArrays, maxPoints);
                // Replace the series with sampled data
                for (let i = 0; i < slicedSeries.length; i++) {
                  const trace = slicedSeries[i] as { x?: string[]; y?: number[]; [key: string]: unknown };
                  if (trace) {
                    trace.x = sampled.dates;
                    trace.y = sampled.dataArrays[i]!;
                  }
                }
              }

          return (
            <div style={{ position: 'relative' }}>
              <Plot
                data={slicedSeries as unknown as Data[]}
                layout={{
                  autosize: true,
                  height: expanded ? undefined : 340,
                  margin: { t: 30, r: 10, l: 40, b: 40 },
                  legend: { orientation: 'h' },
                  hovermode: 'x', // Use x mode to get date on hover
                  xaxis: { showspikes: true, spikemode: 'across', spikesnap: 'cursor', spikethickness: 1 },
                  yaxis:
                    stackedMode === 'percent'
                      ? { title: { text: 'Share of total (%)' }, ticksuffix: '%', range: [0, 100] }
                      : { title: { text: 'Value (USD)' } },
                      paper_bgcolor: 'transparent',
                      plot_bgcolor: 'transparent',
                }}
                style={{ width: '100%', height: expanded ? '100%' : undefined }}
                onHover={(evt: unknown) => {
                  const e = evt as { points?: Array<{ x?: unknown }> } | null;
                  const x = e?.points?.[0]?.x;
                  const day = normalizeHoverDate(x);
                  if (day) setStackedHoverDate(day);
                }}
                onUnhover={() => setStackedHoverDate(null)}
                onLegendClick={handleStackedLegendClick}
                onLegendDoubleClick={handleStackedLegendDoubleClick}
              />
              {stackedHoverItems && (
                <div className="stacked-hover-tooltip">
                  <div className="tooltip-date">{stackedHoverItems.date}</div>
                  <div className="tooltip-total">Total: ${stackedHoverItems.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                  <div className="tooltip-items">
                    {stackedHoverItems.items.map(item => (
                      <div key={item.asset} className="tooltip-item">
                        <span className="tooltip-asset" style={{ color: colorFor(item.asset) }}>
                          {item.asset}
                          </span>
                        <span className="tooltip-value">
                          {stackedMode === 'percent'
                            ? `${item.value.toFixed(1)}%`
                            : `$${item.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        }}
      </ChartCard>

          {/* P&L Chart */}
        <ChartCard
            title="Profit & Loss"
          headerActions={() => (
              <label className="chart-control">
              Asset
                <select value={selectedPnLAsset} onChange={e => setSelectedPnLAsset(e.target.value)}>
                  {assets.map(a => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
              </select>
            </label>
          )}
        >
          {({ timeframe, expanded }) => {
              if (loadingTxs || !txs) {
                return <div className="chart-loading">Loading PnL...</div>;
              }
              if (!pnl.dates.length) {
                return <div className="chart-empty">No PnL data</div>;
              }
            const idx = sliceStartIndexForIsoDates(pnl.dates, timeframe);
            const dates = pnl.dates.slice(idx);
            const realized = pnl.realized.slice(idx);
            const unrealized = pnl.unrealized.slice(idx);
            
            // Sample data points for performance (max 100 points)
            const maxPoints = expanded ? 200 : 100;
            const sampled = sampleDataPoints(dates, [realized, unrealized], maxPoints);
            
            return (
              <Plot
                data={[
                    { x: sampled.dates, y: sampled.dataArrays[0]!, type: 'scatter', mode: 'lines', name: 'Realized', line: { color: '#16a34a' } },
                    { x: sampled.dates, y: sampled.dataArrays[1]!, type: 'scatter', mode: 'lines', name: 'Unrealized', line: { color: '#5b8cff' } },
                ] as Data[]}
                  layout={{
                    autosize: true,
                    height: expanded ? undefined : 320,
                    margin: { t: 30, r: 10, l: 40, b: 40 },
                    legend: { orientation: 'h' },
                    hovermode: 'x unified',
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                  }}
                  style={{ width: '100%', height: expanded ? '100%' : undefined }}
              />
            );
          }}
        </ChartCard>

          {/* BTC Ratio & Accumulation */}
        <ChartCard
            title="BTC Ratio & Accumulation"
          headerActions={() => (
              <label className="chart-control">
                View
                <select value={selectedBtcChart} onChange={e => setSelectedBtcChart(e.target.value)}>
                  <option value="ratio">Ratio</option>
                  <option value="accumulation">Accumulation</option>
              </select>
            </label>
          )}
        >
          {({ timeframe, expanded }) => {
              if (loadingTxs || !txs) {
                return <div className="chart-loading">Loading BTC data...</div>;
              }
              if (!btcRatio.dates.length) {
                return <div className="chart-empty">No BTC data</div>;
              }
              const idx = sliceStartIndexForIsoDates(btcRatio.dates, timeframe);
              const dates = btcRatio.dates.slice(idx);
              const yData = selectedBtcChart === 'ratio' ? btcRatio.btcPercentage.slice(idx) : btcRatio.btcValue.slice(idx);
              
              // Sample data points for performance (max 100 points)
              const maxPoints = expanded ? 200 : 100;
              const sampled = sampleDataWithDates(dates, yData, maxPoints);
              
            return (
              <Plot
                data={[
                    {
                      x: sampled.dates,
                      y: sampled.data,
                      type: 'scatter',
                      mode: 'lines',
                      name: selectedBtcChart === 'ratio' ? 'BTC % of Portfolio' : 'Total Value (BTC)',
                      line: { color: '#f7931a', width: 2 },
                    },
                ] as Data[]}
                  layout={{
                    autosize: true,
                    height: expanded ? undefined : 320,
                    margin: { t: 30, r: 10, l: 40, b: 40 },
                    legend: { orientation: 'h' },
                    hovermode: 'x unified',
                    yaxis: {
                      title: { text: selectedBtcChart === 'ratio' ? 'BTC % of Portfolio' : 'Total Value (BTC)' },
                      ...(selectedBtcChart === 'ratio' ? { ticksuffix: '%', range: [0, 100] } : {}),
                    },
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                  }}
                  style={{ width: '100%', height: expanded ? '100%' : undefined }}
              />
            );
          }}
        </ChartCard>

          {/* Altcoin Holdings BTC Value */}
        <ChartCard
          title="Altcoin Holdings BTC Value"
          headerActions={() => (
              <label className="chart-control">
              Asset
                <select value={selectedAltcoin} onChange={e => setSelectedAltcoin(e.target.value)}>
                <option value="ALL">All Altcoins</option>
                  {assets.filter(a => a !== 'BTC').map(a => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
              </select>
            </label>
          )}
        >
          {({ timeframe, expanded }) => {
              if (loadingTxs || !txs) {
                return <div className="chart-loading">Loading altcoin data...</div>;
              }
              if (!altcoinVsBtc.dates.length) {
                return <div className="chart-empty">No altcoin data</div>;
              }
            const idx = sliceStartIndexForIsoDates(altcoinVsBtc.dates, timeframe);
            const dates = altcoinVsBtc.dates.slice(idx);
            
            // Sample data points for performance (max 100 points)
            const maxPoints = expanded ? 200 : 100;
            const buildTrace = (asset: string) => {
              const yData = (altcoinVsBtc.performance[asset] || []).slice(idx);
              const sampled = sampleDataWithDates(dates, yData, maxPoints);
              return {
                x: sampled.dates,
                y: sampled.data,
              type: 'scatter' as const,
              mode: 'lines' as const,
              name: asset,
              line: { color: colorFor(asset) },
              };
            };
            const traces =
              selectedAltcoin === 'ALL'
                ? assets.filter(a => a !== 'BTC').map(buildTrace)
                : [buildTrace(selectedAltcoin)];
            return (
              <Plot
                data={traces as unknown as Data[]}
                  layout={{
                    autosize: true,
                    height: expanded ? undefined : 320,
                    margin: { t: 30, r: 10, l: 40, b: 40 },
                    legend: { orientation: 'h' },
                    yaxis: { title: { text: 'BTC Value of Holdings' } },
                    hovermode: 'x unified',
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                  }}
                  style={{ width: '100%', height: expanded ? '100%' : undefined }}
              />
            );
          }}
        </ChartCard>

          {/* Profit-Taking Opportunities */}
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
              <label className="chart-control">
              Asset
                <select value={selectedProfitAsset} onChange={e => setSelectedProfitAsset(e.target.value)}>
                  {assets.filter(a => a !== 'BTC').map(a => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
              </select>
            </label>
          )}
        >
          {({ timeframe, expanded }) => {
              if (loadingTxs || !txs) {
                return <div className="chart-loading">Loading opportunities...</div>;
              }
              if (!profitOpportunities.dates.length) {
                return <div className="chart-empty">No opportunities data</div>;
              }
            const idx = sliceStartIndexForIsoDates(profitOpportunities.dates, timeframe);
            const dates = profitOpportunities.dates.slice(idx);

            // Sample data points for performance (max 100 points)
            const maxPoints = expanded ? 200 : 100;
            const makeAssetTraces = (asset: string) => {
              const altcoinPnL = (profitOpportunities.opportunities[asset]?.altcoinPnL || []).slice(idx);
              const btcPnL = (profitOpportunities.opportunities[asset]?.btcPnL || []).slice(idx);
              const sampled = sampleDataPoints(dates, [altcoinPnL, btcPnL], maxPoints);
              return [
                {
                  x: sampled.dates,
                  y: sampled.dataArrays[0]!,
                type: 'scatter' as const,
                mode: 'lines' as const,
                name: `${asset} PnL`,
                line: { color: colorFor(asset) },
              },
              {
                  x: sampled.dates,
                  y: sampled.dataArrays[1]!,
                type: 'scatter' as const,
                mode: 'lines' as const,
                name: 'BTC PnL (if bought instead)',
                line: { color: '#f7931a', dash: 'dash' },
              },
              ];
            };

            const traces = makeAssetTraces(selectedProfitAsset);

            return (
              <Plot
                data={traces as unknown as Data[]}
                  layout={{
                    autosize: true,
                    height: expanded ? undefined : 320,
                    margin: { t: 30, r: 10, l: 40, b: 40 },
                    legend: { orientation: 'h' },
                    yaxis: { title: { text: 'PnL (USD)' } },
                    hovermode: 'x unified',
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                  }}
                  style={{ width: '100%', height: expanded ? '100%' : undefined }}
                />
              );
            }}
          </ChartCard>

          {/* Cost vs Price */}
          <ChartCard
            title="Cost Basis vs Market Price"
            headerActions={() => (
              <label className="chart-control">
                Asset
                <select value={selectedCostAsset} onChange={e => setSelectedCostAsset(e.target.value)}>
                  {assets.map(a => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
            )}
          >
            {({ timeframe, expanded }) => {
              if (loadingTxs || !txs) {
                return <div className="chart-loading">Loading cost vs price...</div>;
              }
              if (!costVsPrice.dates.length) {
                return <div className="chart-empty">No cost vs price data</div>;
              }
              const idx = sliceStartIndexForIsoDates(costVsPrice.dates, timeframe);
              const dates = costVsPrice.dates.slice(idx);
              const avgCost = costVsPrice.avgCost.slice(idx);
              const price = costVsPrice.price.slice(idx);
              
              // Sample data points for performance (max 100 points)
              const maxPoints = expanded ? 200 : 100;
              const sampled = sampleDataPoints(dates, [avgCost, price], maxPoints);
              
              return (
                <Plot
                  data={[
                    {
                      x: sampled.dates,
                      y: sampled.dataArrays[0]!,
                      type: 'scatter',
                      mode: 'lines',
                      name: 'Average Cost',
                      line: { color: '#5b8cff', width: 2 },
                    },
                    {
                      x: sampled.dates,
                      y: sampled.dataArrays[1]!,
                      type: 'scatter',
                      mode: 'lines',
                      name: 'Market Price',
                      line: { color: '#16a34a', width: 2 },
                    },
                  ] as Data[]}
                  layout={{
                    autosize: true,
                    height: expanded ? undefined : 320,
                    margin: { t: 30, r: 10, l: 40, b: 40 },
                    legend: { orientation: 'h' },
                    yaxis: { title: { text: 'Price (USD)' } },
                    hovermode: 'x unified',
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                  }}
                  style={{ width: '100%', height: expanded ? '100%' : undefined }}
                />
              );
            }}
          </ChartCard>

          {/* Position Chart */}
          <ChartCard
            title="Asset Positions Over Time"
            headerActions={() => (
              <label className="chart-control">
                Asset
                <select value={selectedAsset} onChange={e => setSelectedAsset(e.target.value)}>
                  <option value="">All Assets</option>
                  {assets.map(a => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
            )}
          >
            {({ timeframe, expanded }) => {
              if (loadingTxs || !txs) {
                return <div className="chart-loading">Loading positions...</div>;
              }
              if (!positionsFigure.data.length) {
                return <div className="chart-empty">No position data</div>;
              }
              const firstTrace = positionsFigure.data[0] as { x?: string[]; y?: number[] } | undefined;
              const idx = firstTrace?.x
                ? sliceStartIndexForIsoDates(firstTrace.x, timeframe)
                : 0;
              const slicedData = positionsFigure.data.map(trace => {
                const t = trace as { x?: string[]; y?: number[]; [key: string]: unknown };
                return {
                  ...trace,
                  x: t.x ? t.x.slice(idx) : [],
                  y: t.y ? t.y.slice(idx) : [],
                } as Data;
              });
              
              // Sample data points for performance (max 100 points per trace)
              const maxPoints = expanded ? 200 : 100;
              const sampledData = slicedData.map(trace => {
                const t = trace as { x?: string[]; y?: number[]; [key: string]: unknown };
                if (!t.x || !t.y || t.x.length <= maxPoints) return trace;
                const sampled = sampleDataWithDates(t.x, t.y, maxPoints);
                return {
                  ...trace,
                  x: sampled.dates,
                  y: sampled.data,
                } as Data;
              });
              return (
                <Plot
                  data={sampledData}
                  layout={{
                    ...positionsFigure.layout,
                    height: expanded ? undefined : 320,
                    paper_bgcolor: 'transparent',
                    plot_bgcolor: 'transparent',
                  }}
                  style={{ width: '100%', height: expanded ? '100%' : undefined }}
              />
            );
          }}
        </ChartCard>
      </div>
    </main>
    </AuthGuard>
  );
}

export default function DashboardPage() {
  return (
    <DashboardDataProvider>
      <DashboardPageContent />
    </DashboardDataProvider>
  );
}
