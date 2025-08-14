'use client';
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePortfolio } from '../PortfolioProvider';
import { getAssetColor } from '@/lib/assets';

import type { Layout, Data } from 'plotly.js';
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

const fetcher = (url: string) => fetch(url).then(r=>r.json());

async function fetchHistoricalWithLocalCache(symbols: string[], startUnixSec: number, endUnixSec: number): Promise<HistResp> {
  const TTL_MS = 12 * 60 * 60 * 1000; // 12h
  type CacheObj = { expiresAt: number; prices: PricePoint[] };

  function readCache(key: string): PricePoint[] | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw) as CacheObj;
      if (!obj || typeof obj.expiresAt !== 'number' || Date.now() > obj.expiresAt) return null;
      return Array.isArray(obj.prices) ? (obj.prices as PricePoint[]) : null;
    } catch {
      return null;
    }
  }

  function writeCache(key: string, prices: PricePoint[]) {
    try {
      const payload: CacheObj = { expiresAt: Date.now() + TTL_MS, prices };
      localStorage.setItem(key, JSON.stringify(payload));
    } catch {}
  }

  function chunkIntoThreeMonthRanges(startSec: number, endSec: number): Array<{ s: number; e: number }> {
    const out: Array<{ s: number; e: number }> = [];
    let s = new Date(startSec * 1000);
    const endMs = endSec * 1000;
    while (s.getTime() < endMs) {
      const e = new Date(s.getTime());
      e.setMonth(e.getMonth() + 3);
      const ce = Math.min(e.getTime(), endMs);
      out.push({ s: Math.floor(s.getTime() / 1000), e: Math.floor(ce / 1000) });
      s = new Date(ce);
    }
    return out;
  }

  const chunks = chunkIntoThreeMonthRanges(startUnixSec, endUnixSec);
  const all: PricePoint[] = [];
  const symKey = symbols.slice().sort().join(',');

  for (const ch of chunks) {
    const key = `hist:${symKey}:${ch.s}:${ch.e}`;
    const cached = readCache(key);
    if (cached) {
      all.push(...cached);
      continue;
    }
    const url = `/api/prices?symbols=${encodeURIComponent(symKey)}&start=${ch.s}&end=${ch.e}`;
    const resp = await fetch(url);
    if (!resp.ok) continue;
    const json = (await resp.json()) as HistResp;
    const arr = (json?.prices || []) as PricePoint[];
    // store and append
    writeCache(key, arr);
    all.push(...arr);
  }

  // dedupe and sort
  const map = new Map<string, PricePoint>();
  for (const p of all) {
    const k = `${p.date}|${p.asset.toUpperCase()}`;
    if (!map.has(k)) map.set(k, p);
  }
  const merged = Array.from(map.values()).sort((a,b)=> a.date.localeCompare(b.date) || a.asset.localeCompare(b.asset));
  return { prices: merged };
}

type Tx = { id:number; asset:string; type:'Buy'|'Sell'; priceUsd?:number|null; quantity:number; datetime:string; costUsd?:number|null; proceedsUsd?:number|null; notes?: string | null };

type PricePoint = { date: string; asset: string; price_usd: number };

type PricesResp = { prices: Record<string, number> };

type HistResp = { prices: PricePoint[] };

export default function DashboardPage(){
  const { selectedId } = usePortfolio();
  const listKey = selectedId === 'all' ? '/api/transactions' : (selectedId? `/api/transactions?portfolioId=${selectedId}` : null);
  const { data: txs, mutate } = useSWR<Tx[]>(listKey, fetcher);
  const [selectedAsset, setSelectedAsset] = useState<string>('');
  const [selectedPnLAsset, setSelectedPnLAsset] = useState<string>('ALL');
  const [selectedBtcChart, setSelectedBtcChart] = useState<string>('ratio'); // 'ratio' | 'accumulation'
  const [selectedAltcoin, setSelectedAltcoin] = useState<string>('ALL');
  const [selectedProfitAsset, setSelectedProfitAsset] = useState<string>('ALL');

  const assets = useMemo(()=>{
    const s = new Set<string>();
    (txs||[]).forEach(t=> s.add(t.asset.toUpperCase()));
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

  useEffect(()=>{
    if (assets.length && !selectedAsset) setSelectedAsset(assets[0]);
  }, [assets, selectedAsset]);

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
      const a = t.asset.toUpperCase();
      const q = Math.abs(t.quantity);
      pos[a] = (pos[a]||0) + (t.type === 'Buy' ? q : -q);
    }
    return pos;
  }, [txs]);

  // current prices for allocation pie (always include BTC for conversion)
  const symbolsParam = useMemo(()=>{
    const set = new Set(assets);
    set.add('BTC');
    return Array.from(set).join(',');
  }, [assets]);
  const { data: curr } = useSWR<PricesResp>(assets.length? `/api/prices/current?symbols=${encodeURIComponent(symbolsParam)}`: null, fetcher, { revalidateOnFocus: false });

  // daily positions time series
  const dailyPos = useMemo(()=>{
    if (!txs || txs.length===0) return [] as { date:string; asset:string; position:number }[];
    const rows = txs.map(t=> ({ asset: t.asset.toUpperCase(), date: new Date(t.datetime) , signed: (t.type==='Buy'? 1 : -1) * Math.abs(t.quantity) }));
    // group by day and asset
    const byKey = new Map<string, number>();
    for (const r of rows){
      const day = new Date(r.date.getFullYear(), r.date.getMonth(), r.date.getDate());
      const key = day.toISOString().slice(0,10) + '|' + r.asset;
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
      const a = t.asset.toUpperCase();
      const day = new Date(new Date(t.datetime).getFullYear(), new Date(t.datetime).getMonth(), new Date(t.datetime).getDate());
      const key = day.toISOString().slice(0,10) + '|' + a;
      const note = t.notes ? String(t.notes).trim() : '';
      if (!note) continue;
      const prev = map.get(key);
      map.set(key, prev ? `${prev}\n• ${note}` : `• ${note}`);
    }
    return map;
  }, [txs]);

  // historical prices for portfolio value stacked area
  const dateRange = useMemo(()=>{
    if (!txs || txs.length===0) return null as null | { start: number; end: number };
    const dts = txs.map(t=> new Date(t.datetime).getTime());
    const min = Math.min(...dts);
    const now = Date.now();
    return { start: Math.floor(min/1000), end: Math.floor(now/1000) };
  }, [txs]);

  const histKey = dateRange && assets.length ? `hist:${JSON.stringify({ symbols: assets, start: dateRange.start, end: dateRange.end })}` : null;
  const { data: hist } = useSWR<HistResp>(
    histKey,
    async (key: string) => {
      const parsed = JSON.parse(key.slice(5)) as { symbols: string[]; start: number; end: number };
      return fetchHistoricalWithLocalCache(parsed.symbols, parsed.start, parsed.end);
    },
    { revalidateOnFocus: false }
  );

  // derive portfolio value over time stacked by asset
  const stacked = useMemo(()=>{
    if (!hist || !hist.prices || dailyPos.length===0) return { x: [], series: [] as Data[] };
    // index price by date+asset
    const priceMap = new Map<string, number>();
    for (const p of hist.prices){ priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd); }
    // positions by date+asset
    const posMap = new Map<string, number>();
    for (const p of dailyPos){ posMap.set(p.date + '|' + p.asset.toUpperCase(), p.position); }
    // all dates
    const dates = Array.from(new Set(hist.prices.map(p=>p.date))).sort();
    const traces: Data[] = [];
    const totals: number[] = new Array(dates.length).fill(0);
    for (const a of assets){
      const y:number[] = [];
      let lastPos = 0;
      for (const d of dates){
        const key = d + '|' + a;
        if (posMap.has(key)) lastPos = posMap.get(key)!;
        const price = priceMap.get(key);
        const val = price? price*lastPos : 0;
        y.push(val);
        // accumulate total per date index
        const idx = dates.indexOf(d);
        if (idx >= 0) totals[idx] += val;
      }
      const lc = colorFor(a);
      traces.push({ x: dates, y, type:'scatter', mode:'lines', stackgroup:'one', name: a, line: { color: lc }, fillcolor: withAlpha(lc, 0.25) } as Data);
    }
    // Add invisible total line just for unified hover
    traces.push({ x: dates, y: totals, type:'scatter', mode:'lines', name:'Total', line:{ width:0 }, hovertemplate: 'Total: %{y:.2f}<extra></extra>', showlegend:false } as Data);
    return { x: [], series: traces };
  }, [hist, dailyPos, assets, colorFor]);

  // PnL over time (realized/unrealized split) - supports filtering by asset
  const pnl = useMemo(() => {
    if (!hist || !hist.prices || assets.length === 0 || !txs || txs.length === 0) {
      return { dates: [] as string[], realized: [] as number[], unrealized: [] as number[] };
    }
    const priceMap = new Map<string, number>();
    for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);

    const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();

    // Filter transactions by selected asset if not 'ALL'
    const filteredTxs = selectedPnLAsset === 'ALL' ? txs : txs.filter(t => t.asset.toUpperCase() === selectedPnLAsset);
    
    // Filter assets for calculation
    const relevantAssets = selectedPnLAsset === 'ALL' ? assets : [selectedPnLAsset];

    // Prepare transactions grouped by date per asset with unit price
    type TxEnriched = { asset: string; type: 'Buy'|'Sell'; units: number; unitPrice: number };
    const txByDate = new Map<string, TxEnriched[]>();
    for (const t of filteredTxs) {
      const asset = t.asset.toUpperCase();
      const day = new Date(new Date(t.datetime).getFullYear(), new Date(t.datetime).getMonth(), new Date(t.datetime).getDate()).toISOString().slice(0, 10);
      const key = day;
      const fallback = priceMap.get(day + '|' + asset) ?? 0;
      const unitPrice = (t.priceUsd != null ? t.priceUsd : fallback) || 0;
      const units = Math.abs(t.quantity);
      const arr = txByDate.get(key) || [];
      arr.push({ asset, type: t.type, units, unitPrice });
      txByDate.set(key, arr);
    }

    // Track per-asset inventory and cost value using average cost method
    const heldUnits = new Map<string, number>();
    const heldCost = new Map<string, number>(); // total cost value for held units
    let realizedCum = 0;
    const realizedSeries: number[] = [];
    const unrealizedSeries: number[] = [];

    for (const d of dates) {
      const todays = txByDate.get(d) || [];
      // Process transactions for today
      for (const tx of todays) {
        const uPrev = heldUnits.get(tx.asset) || 0;
        const cPrev = heldCost.get(tx.asset) || 0;
        if (tx.type === 'Buy') {
          // Add units and cost
          heldUnits.set(tx.asset, uPrev + tx.units);
          heldCost.set(tx.asset, cPrev + tx.units * tx.unitPrice);
        } else {
          // Sell: realize PnL using average cost
          const avg = uPrev > 0 ? (cPrev / uPrev) : 0;
          const qty = Math.min(tx.units, uPrev);
          const proceeds = tx.unitPrice * qty;
          const cost = avg * qty;
          realizedCum += (proceeds - cost);
          heldUnits.set(tx.asset, uPrev - qty);
          heldCost.set(tx.asset, cPrev - cost);
        }
      }

      // Compute unrealized = market value - remaining cost value
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

    return { dates, realized: realizedSeries, unrealized: unrealizedSeries };
  }, [hist, txs, assets, selectedPnLAsset]);

  // Cost basis vs market price for selected asset
  const costVsPrice = useMemo(() => {
    if (!hist || !hist.prices || !selectedAsset) return { dates: [] as string[], avgCost: [] as number[], price: [] as number[] };
    const asset = selectedAsset.toUpperCase();
    const dates = Array.from(new Set(hist.prices.filter(p => p.asset.toUpperCase() === asset).map(p => p.date))).sort();
    // build tx map for this asset
    const txsA = (txs || []).filter(t => t.asset.toUpperCase() === asset)
      .map(t => ({ date: new Date(new Date(t.datetime).getFullYear(), new Date(t.datetime).getMonth(), new Date(t.datetime).getDate()).toISOString().slice(0,10), type: t.type as 'Buy'|'Sell', units: Math.abs(t.quantity), unitPrice: t.priceUsd || 0 }));
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
  }, [hist, txs, selectedAsset]);

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

  const allocationFigure = useMemo(()=>{
    if (!curr || !curr.prices) return { data:[], layout:{} };
    const points = Object.entries(holdings)
      .map(([a, units])=> ({ asset: a, value: curr.prices![a] ? curr.prices![a] * units : 0 }))
      .filter(p=> p.value>0);
    const labels = points.map(p=>p.asset);
    const data: Data[] = [{ type:'pie', labels, values: points.map(p=>p.value), hole:0.45, marker: { colors: labels.map(colorFor) } } as unknown as Data];
    const layout: Partial<Layout> = { autosize:true, height:320, margin:{ t:30, r:10, l:10, b:10 } };
    return { data, layout };
  }, [curr, holdings, colorFor]);

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

    if (curr && curr.prices) {
      for (const [a, units] of Object.entries(holdings)) {
        if (units <= 0) continue;
        const price = curr.prices[a] || 0;
        currentValue += price * units;
      }
      const btcPrice = curr.prices['BTC'] || 0;
      if (btcPrice > 0) currentValueBtc = currentValue / btcPrice;
    }

    // 24h change uses last two available daily prices from hist
    if (hist && hist.prices && hist.prices.length > 0) {
      const dates = Array.from(new Set(hist.prices.map(p=>p.date))).sort();
      const n = dates.length;
      if (n >= 2) {
        const currDate = dates[n-1];
        const prevDate = dates[n-2];
        const lastMap = new Map<string, number>();
        const prevMap = new Map<string, number>();
        for (const p of hist.prices) {
          if (p.date === currDate) lastMap.set(p.asset.toUpperCase(), p.price_usd);
          if (p.date === prevDate) prevMap.set(p.asset.toUpperCase(), p.price_usd);
        }
        topDelta = -Infinity; topAsset = '';
        for (const [a, units] of Object.entries(holdings)) {
          if (units <= 0) continue; // only assets currently held
          const cp = lastMap.get(a) ?? 0;
          const pp = prevMap.get(a) ?? cp;
          const delta = (cp - pp) * units;
          dayChange += delta;
          if (delta > topDelta) { topDelta = delta; topAsset = a; }
        }
        if (currentValue > 0) dayChangePct = (dayChange / (currentValue - dayChange)) * 100;
      }
    }

    // Total P/L from earlier pnl calc: last realized + unrealized
    let totalPL = 0;
    let totalPLPct = 0;
    if (pnl.dates.length) {
      const i = pnl.dates.length - 1;
      totalPL = (pnl.realized[i] || 0) + (pnl.unrealized[i] || 0);
      if (currentValue - pnl.unrealized[i] !== 0) totalPLPct = (totalPL / (currentValue - pnl.unrealized[i])) * 100;
    }

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
  }, [curr, holdings, hist, pnl]);

  // BTC Ratio Chart - tracks portfolio BTC value over time
  const btcRatio = useMemo(() => {
    if (!hist || !hist.prices || assets.length === 0 || !txs || txs.length === 0) {
      return { dates: [] as string[], btcValue: [] as number[], btcPercentage: [] as number[] };
    }
    
    const priceMap = new Map<string, number>();
    for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);
    
    const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
    const btcValue: number[] = [];
    const btcPercentage: number[] = [];
    
    for (const date of dates) {
      let totalValue = 0;
      let btcValueForDate = 0;
      
      // Calculate total portfolio value and BTC value for this date
      for (const asset of assets) {
        const price = priceMap.get(date + '|' + asset) || 0;
        const units = holdings[asset] || 0;
        const assetValue = price * units;
        totalValue += assetValue;
        
        if (asset === 'BTC') {
          btcValueForDate = assetValue;
        }
      }
      
      btcValue.push(btcValueForDate);
      btcPercentage.push(totalValue > 0 ? (btcValueForDate / totalValue) * 100 : 0);
    }
    
    return { dates, btcValue, btcPercentage };
  }, [hist, assets, holdings]);

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
          tx.asset.toUpperCase() === asset && 
          new Date(tx.datetime).toISOString().slice(0, 10) <= date
        );
        
        // Calculate position for this asset up to this date
        currentPosition = relevantTxs.reduce((pos, tx) => {
          const quantity = Math.abs(tx.quantity);
          return pos + (tx.type === 'Buy' ? quantity : -quantity);
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
          tx.asset.toUpperCase() === asset && 
          new Date(tx.datetime).toISOString().slice(0, 10) <= date
        );
        
        let totalQuantity = 0;
        let totalCostUsd = 0;
        
        for (const tx of relevantTxs) {
          const quantity = Math.abs(tx.quantity);
          if (tx.type === 'Buy') {
            totalQuantity += quantity;
            totalCostUsd += quantity * (tx.priceUsd || 0);
          } else {
            totalQuantity -= quantity;
            // For sells, reduce cost basis proportionally
            if (totalQuantity > 0) {
              const avgCost = totalCostUsd / (totalQuantity + quantity);
              totalCostUsd -= quantity * avgCost;
            }
          }
        }
        
        // Calculate current altcoin PnL
        const currentValueUsd = totalQuantity * currentPrice;
        const altcoinPnLValue = currentValueUsd - totalCostUsd;
        altcoinPnL.push(altcoinPnLValue);
        
        // Calculate what BTC PnL would be if we had bought BTC instead
        let btcPnLValue = 0;
        if (totalCostUsd > 0 && currentBtcPrice > 0) {
          // Calculate how much BTC we could have bought with the same USD at the time of transactions
          let totalBtcQuantity = 0;
          let totalBtcCostUsd = 0;
          
          for (const tx of relevantTxs) {
            const quantity = Math.abs(tx.quantity);
            const txDate = new Date(tx.datetime).toISOString().slice(0, 10);
            const btcPriceAtTx = priceMap.get(txDate + '|' + 'BTC') || currentBtcPrice; // Use BTC price at transaction time
            
            if (tx.type === 'Buy') {
              const costUsd = quantity * (tx.priceUsd || 0);
              const btcQuantity = costUsd / btcPriceAtTx;
              totalBtcQuantity += btcQuantity;
              totalBtcCostUsd += costUsd;
            } else {
              // For sells, reduce BTC position proportionally
              if (totalBtcQuantity > 0) {
                const avgBtcCost = totalBtcCostUsd / totalBtcQuantity;
                const costUsd = quantity * (tx.priceUsd || 0);
                const btcQuantity = costUsd / btcPriceAtTx;
                totalBtcQuantity -= btcQuantity;
                totalBtcCostUsd -= btcQuantity * avgBtcCost;
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

  // BTC Accumulation Chart
  const btcAccumulation = useMemo(() => {
    if (!txs || txs.length === 0 || !hist || !hist.prices) {
      return { dates: [] as string[], btcHeld: [] as number[], altcoinBtcValue: [] as number[] };
    }
    
    // Create a map of BTC prices by date for accurate conversion
    const btcPriceMap = new Map<string, number>();
    for (const p of hist.prices) {
      if (p.asset.toUpperCase() === 'BTC') {
        btcPriceMap.set(p.date, p.price_usd);
      }
    }
    
    // Get all unique dates from historical prices
    const allDates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
    const btcHeld: number[] = [];
    const altcoinBtcValue: number[] = [];
    
    for (const date of allDates) {
      // Calculate BTC holdings for this date
      const btcTxs = txs.filter(tx => 
        tx.asset.toUpperCase() === 'BTC' && 
        new Date(tx.datetime).toISOString().slice(0, 10) <= date
      );
      
      const currentBtcHeld = btcTxs.reduce((total, tx) => {
        const quantity = Math.abs(tx.quantity);
        return total + (tx.type === 'Buy' ? quantity : -quantity);
      }, 0);
      
      // Calculate BTC value of altcoin holdings for this date
      let totalAltcoinBtcValue = 0;
      const btcPrice = btcPriceMap.get(date) || 50000; // Fallback to $50k
      
      for (const asset of assets) {
        if (asset === 'BTC') continue; // Skip BTC itself
        
        // Get position for this asset up to this date
        const assetTxs = txs.filter(tx => 
          tx.asset.toUpperCase() === asset && 
          new Date(tx.datetime).toISOString().slice(0, 10) <= date
        );
        
        const position = assetTxs.reduce((total, tx) => {
          const quantity = Math.abs(tx.quantity);
          return total + (tx.type === 'Buy' ? quantity : -quantity);
        }, 0);
        
        if (position > 0) {
          // Get asset price for this date
          const assetPrice = hist.prices.find(p => 
            p.date === date && p.asset.toUpperCase() === asset
          )?.price_usd || 0;
          
          if (assetPrice > 0 && btcPrice > 0) {
            const assetValueUsd = position * assetPrice;
            const btcEquivalent = assetValueUsd / btcPrice;
            totalAltcoinBtcValue += btcEquivalent;
          }
        }
      }
      
      btcHeld.push(currentBtcHeld);
      altcoinBtcValue.push(totalAltcoinBtcValue);
    }
    
    return { dates: allDates, btcHeld, altcoinBtcValue };
  }, [txs, hist, assets]);

  // Correlation Heatmap
  const correlationHeatmap = useMemo(() => {
    if (!hist || !hist.prices || assets.length < 2) {
      return { assets: [] as string[], correlations: [] as number[][] };
    }
    
    const priceMap = new Map<string, number[]>();
    const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
    
    // Get price series for each asset
    for (const asset of assets) {
      const prices: number[] = [];
      for (const date of dates) {
        const price = hist.prices.find(p => p.date === date && p.asset.toUpperCase() === asset)?.price_usd || 0;
        prices.push(price);
      }
      priceMap.set(asset, prices);
    }
    
    // Calculate correlations
    const correlations: number[][] = [];
    for (const asset1 of assets) {
      const row: number[] = [];
      for (const asset2 of assets) {
        const prices1 = priceMap.get(asset1) || [];
        const prices2 = priceMap.get(asset2) || [];
        
        if (prices1.length === prices2.length && prices1.length > 1) {
          const correlation = calculateCorrelation(prices1, prices2);
          row.push(correlation);
        } else {
          row.push(0);
        }
      }
      correlations.push(row);
    }
    
    return { assets, correlations };
  }, [hist, assets]);

  // Helper function for correlation calculation
  function calculateCorrelation(x: number[], y: number[]): number {
    const n = x.length;
    if (n !== y.length || n === 0) return 0;
    
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((a, b, i) => a + b * y[i], 0);
    const sumX2 = x.reduce((a, b) => a + b * b, 0);
    const sumY2 = y.reduce((a, b) => a + b * b, 0);
    
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    
    return denominator === 0 ? 0 : numerator / denominator;
  }

  return (
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
          <div className="label">Total Profit / Loss</div>
          <div className="value" style={{ color: (summary.totalPLText.startsWith('+')? '#16a34a' : '#dc2626') }}>{summary.totalPLText} <span style={{ color:'var(--muted)', fontSize: '0.9em' }}>{summary.totalPLPctText}</span></div>
        </div>
        <div className="stat">
          <div className="label">Top Performer (24h)</div>
          <div className="value">{summary.topAsset || '—'} {summary.topAsset? <span style={{ color:'#16a34a', marginLeft:8 }}>{summary.topDeltaText}</span> : null}</div>
        </div>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <section className="card">
          <h2>Allocation by current value</h2>
          <Plot data={allocationFigure.data} layout={allocationFigure.layout} style={{ width:'100%' }} />
        </section>
        <section className="card">
          <h2>PnL over time</h2>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>Asset
              <select value={selectedPnLAsset} onChange={e=>setSelectedPnLAsset(e.target.value)}>
                <option value="ALL">All Assets (Portfolio)</option>
                {assets.map(a=> (<option key={a} value={a}>{a}</option>))}
              </select>
            </label>
          </div>
          <Plot
            data={[
              { x: pnl.dates, y: pnl.realized, type:'scatter', mode:'lines', name:'Realized' },
              { x: pnl.dates, y: pnl.unrealized, type:'scatter', mode:'lines', name:'Unrealized' },
            ] as Data[]}
            layout={{ autosize:true, height:320, margin:{ t:30, r:10, l:40, b:40 }, legend:{ orientation:'h' } }}
            style={{ width:'100%' }}
          />
        </section>
      </div>
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <section className="card">
          <h2>Positions over time (by asset)</h2>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>Asset
              <select value={selectedAsset} onChange={e=>setSelectedAsset(e.target.value)}>
                {assets.map(a=> (<option key={a} value={a}>{a}</option>))}
              </select>
            </label>
          </div>
          <Plot data={positionsFigure.data} layout={positionsFigure.layout} style={{ width:'100%' }} />
        </section>
        <section className="card">
          <h2>Average cost vs market price ({selectedAsset || '...'})</h2>
          <Plot
            data={[
              { x: costVsPrice.dates, y: costVsPrice.avgCost, type:'scatter', mode:'lines', name:'Avg cost', line: { color: '#888888', dash: 'dot' } },
              { x: costVsPrice.dates, y: costVsPrice.price, type:'scatter', mode:'lines', name:'Market price', line: { color: colorFor(selectedAsset||'') } },
            ] as Data[]}
            layout={{ autosize:true, height:320, margin:{ t:30, r:10, l:40, b:40 }, legend:{ orientation:'h' } }}
            style={{ width:'100%' }}
          />
        </section>
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Portfolio value over time (stacked)</h2>
        <Plot data={stacked.series} layout={{ autosize:true, height:340, margin:{ t:30, r:10, l:40, b:40 }, legend:{ orientation:'h' }, hovermode: 'x unified' }} style={{ width:'100%' }} />
      </section>

      {/* BTC Maximization Charts */}
      <div className="grid grid-2" style={{ marginTop: 16, marginBottom: 16 }}>
        <section className="card">
          <h2>BTC Ratio & Accumulation</h2>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>Chart Type
              <select value={selectedBtcChart} onChange={e=>setSelectedBtcChart(e.target.value)}>
                <option value="ratio">BTC Ratio (%)</option>
                <option value="accumulation">BTC Accumulation</option>
              </select>
            </label>
          </div>
          {selectedBtcChart === 'ratio' ? (
            <Plot
              data={[
                { x: btcRatio.dates, y: btcRatio.btcPercentage, type:'scatter', mode:'lines', name:'BTC % of Portfolio', line: { color: '#f7931a' } },
              ] as Data[]}
              layout={{ autosize:true, height:320, margin:{ t:30, r:10, l:40, b:40 }, legend:{ orientation:'h' }, yaxis: { title: { text: 'BTC % of Portfolio' } } }}
              style={{ width:'100%' }}
            />
          ) : (
            <Plot
              data={[
                { 
                  x: btcAccumulation.dates, 
                  y: btcAccumulation.btcHeld, 
                  type: 'scatter', 
                  mode: 'lines', 
                  name: 'BTC Held', 
                  line: { color: '#f7931a' },
                  fill: 'tonexty',
                  fillcolor: 'rgba(247, 147, 26, 0.3)'
                },
                { 
                  x: btcAccumulation.dates, 
                  y: btcAccumulation.altcoinBtcValue, 
                  type: 'scatter', 
                  mode: 'lines', 
                  name: 'Altcoin BTC Value', 
                  line: { color: '#16a34a' },
                  fill: 'tonexty',
                  fillcolor: 'rgba(22, 163, 74, 0.3)'
                },
                { 
                  x: btcAccumulation.dates, 
                  y: btcAccumulation.dates.map((_, i) => 
                    (btcAccumulation.btcHeld[i] || 0) + (btcAccumulation.altcoinBtcValue[i] || 0)
                  ), 
                  type: 'scatter', 
                  mode: 'lines', 
                  name: 'Total Portfolio BTC', 
                  line: { color: '#3b82f6', width: 3 },
                  fill: 'tonexty',
                  fillcolor: 'rgba(59, 130, 246, 0.1)'
                }
              ] as Data[]}
              layout={{ 
                autosize: true, 
                height: 320, 
                margin: { t: 30, r: 10, l: 40, b: 40 }, 
                legend: { orientation: 'h' }, 
                yaxis: { title: { text: 'BTC Amount' } },
                hovermode: 'x unified'
              }}
              style={{ width:'100%' }}
            />
          )}
        </section>
        <section className="card">
          <h2>Altcoin Holdings BTC Value</h2>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>Asset
              <select value={selectedAltcoin} onChange={e=>setSelectedAltcoin(e.target.value)}>
                <option value="ALL">All Altcoins</option>
                {assets.filter(a => a !== 'BTC').map(a=> (<option key={a} value={a}>{a}</option>))}
              </select>
            </label>
          </div>
          <Plot
            data={
              selectedAltcoin === 'ALL' 
                ? assets.filter(a => a !== 'BTC').map(asset => ({
                    x: altcoinVsBtc.dates,
                    y: altcoinVsBtc.performance[asset] || [],
                    type: 'scatter' as const,
                    mode: 'lines' as const,
                    name: asset,
                    line: { color: colorFor(asset) }
                  }))
                : [{
                    x: altcoinVsBtc.dates,
                    y: altcoinVsBtc.performance[selectedAltcoin] || [],
                    type: 'scatter' as const,
                    mode: 'lines' as const,
                    name: selectedAltcoin,
                    line: { color: colorFor(selectedAltcoin) }
                  }]
            }
            layout={{ autosize:true, height:320, margin:{ t:30, r:10, l:40, b:40 }, legend:{ orientation:'h' }, yaxis: { title: { text: 'BTC Value of Holdings' } } }}
            style={{ width:'100%' }}
          />
        </section>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <section className="card">
          <h2>Profit-Taking Opportunities (Altcoin vs BTC PnL)</h2>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>Asset
              <select value={selectedProfitAsset} onChange={e=>setSelectedProfitAsset(e.target.value)}>
                <option value="ALL">All Assets</option>
                {assets.filter(a => a !== 'BTC').map(a=> (<option key={a} value={a}>{a}</option>))}
              </select>
            </label>
          </div>
          <Plot
            data={[
              ...(selectedProfitAsset !== 'ALL' ? [
                {
                  x: profitOpportunities.dates,
                  y: profitOpportunities.opportunities[selectedProfitAsset]?.altcoinPnL || [],
                  type: 'scatter' as const,
                  mode: 'lines' as const,
                  name: `${selectedProfitAsset} PnL`,
                  line: { color: colorFor(selectedProfitAsset) }
                },
                {
                  x: profitOpportunities.dates,
                  y: profitOpportunities.opportunities[selectedProfitAsset]?.btcPnL || [],
                  type: 'scatter' as const,
                  mode: 'lines' as const,
                  name: 'BTC PnL (if bought instead)',
                  line: { color: '#f7931a', dash: 'dash' }
                }
              ] : [
                ...assets.filter(a => a !== 'BTC').map(asset => ({
                  x: profitOpportunities.dates,
                  y: profitOpportunities.opportunities[asset]?.altcoinPnL || [],
                  type: 'scatter' as const,
                  mode: 'lines' as const,
                  name: `${asset} PnL`,
                  line: { color: colorFor(asset) }
                }))
              ])
            ] as Data[]}
            layout={{ 
              autosize: true, 
              height: 320, 
              margin: { t: 30, r: 10, l: 40, b: 40 }, 
              legend: { orientation: 'h' }, 
              yaxis: { title: { text: 'PnL (USD)' } },
              hovermode: 'x unified'
            }}
            style={{ width:'100%' }}
          />
        </section>
        <section className="card">
          <h2>Asset Correlation Heatmap</h2>
          <Plot
            data={[
              {
                z: correlationHeatmap.correlations,
                x: correlationHeatmap.assets,
                y: correlationHeatmap.assets,
                type: 'heatmap',
                colorscale: 'RdBu'
              } as Data
            ]}
            layout={{ 
              autosize: true, 
              height: 320, 
              margin: { t: 30, r: 10, l: 40, b: 40 },
              xaxis: { title: { text: 'Assets' } },
              yaxis: { title: { text: 'Assets' } }
            }}
            style={{ width:'100%' }}
          />
        </section>
      </div>
    </main>
  );
}
