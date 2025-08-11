'use client';
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { useEffect, useMemo, useState } from 'react';
import { usePortfolio } from '../PortfolioProvider';

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

type Tx = { id:number; asset:string; type:'Buy'|'Sell'; priceUsd?:number|null; quantity:number; datetime:string; costUsd?:number|null; proceedsUsd?:number|null };

type PricePoint = { date: string; asset: string; price_usd: number };

type PricesResp = { prices: Record<string, number> };

type HistResp = { prices: PricePoint[] };

export default function DashboardPage(){
  const { selectedId } = usePortfolio();
  const listKey = selectedId === 'all' ? '/api/transactions' : (selectedId? `/api/transactions?portfolioId=${selectedId}` : null);
  const { data: txs } = useSWR<Tx[]>(listKey, fetcher);
  const [selectedAsset, setSelectedAsset] = useState<string>('');

  const assets = useMemo(()=>{
    const s = new Set<string>();
    (txs||[]).forEach(t=> s.add(t.asset.toUpperCase()));
    return Array.from(s).sort();
  }, [txs]);

  // Brand colors by asset symbol (uppercase)
  const ASSET_COLORS: Record<string, string> = useMemo(() => ({
    BTC: '#f7931a',
    ETH: '#3c3c3d',
    ADA: '#0033ad',
    XRP: '#000000',
    DOT: '#e6007a',
    LINK: '#2a5ada',
    SOL: '#00ffa3',
    AVAX: '#e84142',
    SUI: '#6fbcf0',
    USDT: '#26a17b',
  }), []);

  function colorFor(asset: string): string {
    const key = asset.toUpperCase();
    return ASSET_COLORS[key] || '#9aa3b2';
  }

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

  // current prices for allocation pie
  const symbolsParam = assets.join(',');
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
      const note = (t as any).notes ? String((t as any).notes).trim() : '';
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
  }, [hist, dailyPos, assets]);

  // PnL over time (realized/unrealized split)
  const pnl = useMemo(() => {
    if (!hist || !hist.prices || assets.length === 0 || !txs || txs.length === 0) {
      return { dates: [] as string[], realized: [] as number[], unrealized: [] as number[] };
    }
    const priceMap = new Map<string, number>();
    for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);

    const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();

    // Prepare transactions grouped by date per asset with unit price
    type TxEnriched = { asset: string; type: 'Buy'|'Sell'; units: number; unitPrice: number };
    const txByDate = new Map<string, TxEnriched[]>();
    for (const t of txs) {
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
      for (const a of assets) {
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
  }, [hist, txs, assets]);

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
  }, [dailyPos, selectedAsset]);

  const allocationFigure = useMemo(()=>{
    if (!curr || !curr.prices) return { data:[], layout:{} };
    const points = Object.entries(holdings)
      .map(([a, units])=> ({ asset: a, value: curr.prices![a] ? curr.prices![a] * units : 0 }))
      .filter(p=> p.value>0);
    const labels = points.map(p=>p.asset);
    const data: Data[] = [{ type:'pie', labels, values: points.map(p=>p.value), hole:0.45, marker: { colors: labels.map(colorFor) } } as unknown as Data];
    const layout: Partial<Layout> = { autosize:true, height:320, margin:{ t:30, r:10, l:10, b:10 } };
    return { data, layout };
  }, [curr, holdings]);

  return (
    <main>
      <h1>Dashboard</h1>
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <section className="card">
          <h2>Allocation by current value</h2>
          <Plot data={allocationFigure.data} layout={allocationFigure.layout} style={{ width:'100%' }} />
        </section>
        <section className="card">
          <h2>PnL over time</h2>
          <Plot
            data={[
              { x: pnl.dates, y: pnl.realized, type:'scatter', mode:'lines', name:'Realized' },
              { x: pnl.dates, y: pnl.unrealized, type:'scatter', mode:'lines', name:'Unrealized' },
            ] as any}
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
            ] as any}
            layout={{ autosize:true, height:320, margin:{ t:30, r:10, l:40, b:40 }, legend:{ orientation:'h' } }}
            style={{ width:'100%' }}
          />
        </section>
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <h2>Portfolio value over time (stacked)</h2>
        <Plot data={stacked.series} layout={{ autosize:true, height:340, margin:{ t:30, r:10, l:40, b:40 }, legend:{ orientation:'h' }, hovermode: 'x unified' }} style={{ width:'100%' }} />
      </section>
    </main>
  );
}
