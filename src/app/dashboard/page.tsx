'use client';
import dynamic from 'next/dynamic';
import useSWR from 'swr';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePortfolio } from '../PortfolioProvider';
import { getAssetColor, getFiatCurrencies, convertFiat, isFiatCurrency } from '@/lib/assets';

import type { Layout, Data } from 'plotly.js';
import { jsonFetcher } from '@/lib/swr-fetcher';
import type { Transaction as Tx, PricesResp, HistResp } from '@/lib/types';
import { fetchHistoricalWithLocalCache } from '@/lib/prices-cache';
const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

const fetcher = jsonFetcher;

// Types and historical fetcher moved to lib


export default function DashboardPage(){
  const { selectedId } = usePortfolio();
  const listKey = selectedId === 'all' ? '/api/transactions' : (selectedId? `/api/transactions?portfolioId=${selectedId}` : null);
  const { data: txs, mutate, isLoading: loadingTxs } = useSWR<Tx[]>(listKey, fetcher);
  const [selectedAsset, setSelectedAsset] = useState<string>('');
  const [selectedPnLAsset, setSelectedPnLAsset] = useState<string>('ALL');
  const [selectedBtcChart, setSelectedBtcChart] = useState<string>('ratio'); // 'ratio' | 'accumulation'
  const [selectedAltcoin, setSelectedAltcoin] = useState<string>('ALL');
  const [selectedProfitAsset, setSelectedProfitAsset] = useState<string>('ALL');
  const [heatmapTimeframe, setHeatmapTimeframe] = useState<string>('24h'); // 'current' | '24h' | '7d' | '30d'

  const assets = useMemo(()=>{
    const s = new Set<string>();
    (txs||[]).forEach(t=> { const a=t.asset.toUpperCase(); if (a!== 'USD') s.add(a); });
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
      if (a==='USD') continue;
      if (!(t.type==='Buy' || t.type==='Sell')) continue;
      const q = Math.abs(t.quantity);
      pos[a] = (pos[a]||0) + (t.type === 'Buy' ? q : -q);
    }
    return pos;
  }, [txs]);

  // Calculate cash balances (fiat currencies)
  const cashBalances = useMemo(() => {
    const balances: Record<string, number> = {};
    const fiatCurrencies = getFiatCurrencies();
    
    if (!txs) return balances;
    
    // Initialize balances for all fiat currencies
    fiatCurrencies.forEach(currency => {
      balances[currency] = 0;
    });
    
    // Process all transactions in chronological order
    const sortedTxs = [...txs].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
    
    for (const tx of sortedTxs) {
      const asset = tx.asset.toUpperCase();
      
      if (fiatCurrencies.includes(asset)) {
        // Handle fiat currency transactions (deposits/withdrawals)
        if (tx.type === 'Deposit') {
          balances[asset] += tx.quantity;
        } else if (tx.type === 'Withdrawal') {
          balances[asset] -= tx.quantity;
        }
      } else if (tx.type === 'Buy') {
        // Handle crypto purchases - deduct from cash balance
        // For now, assume all purchases are made from USD (we could enhance this later)
        const costUsd = tx.costUsd || (tx.priceUsd ? tx.priceUsd * tx.quantity : 0);
        if (costUsd > 0) {
          balances['USD'] -= costUsd;
        }
      } else if (tx.type === 'Sell') {
        // Handle crypto sales - add to cash balance
        const proceedsUsd = tx.proceedsUsd || (tx.priceUsd ? tx.priceUsd * tx.quantity : 0);
        if (proceedsUsd > 0) {
          balances['USD'] += proceedsUsd;
        }
      }
    }
    
    return balances;
  }, [txs]);

  // Calculate total cash balance in USD equivalent
  const totalCashBalanceUsd = useMemo(() => {
    let total = 0;
    for (const [currency, balance] of Object.entries(cashBalances)) {
      total += convertFiat(balance, currency, 'USD');
    }
    return total;
  }, [cashBalances]);

  // current prices for allocation pie (always include BTC for conversion)
  const symbolsParam = useMemo(()=>{
    const set = new Set(assets);
    set.add('BTC');
    return Array.from(set).join(',');
  }, [assets]);
  const { data: curr, isLoading: loadingCurr } = useSWR<PricesResp>(assets.length? `/api/prices/current?symbols=${encodeURIComponent(symbolsParam)}`: null, fetcher, { revalidateOnFocus: false });

  // daily positions time series
  const dailyPos = useMemo(()=>{
    if (!txs || txs.length===0) return [] as { date:string; asset:string; position:number }[];
    const rows = txs.filter(t=> t.asset.toUpperCase() !== 'USD' && (t.type==='Buy' || t.type==='Sell'))
      .map(t=> ({ asset: t.asset.toUpperCase(), date: new Date(t.datetime) , signed: (t.type==='Buy'? 1 : -1) * Math.abs(t.quantity) }));
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
  const { data: hist, isLoading: loadingHist } = useSWR<HistResp>(
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
    const filteredTxs = (selectedPnLAsset === 'ALL' ? txs : txs.filter(t => t.asset.toUpperCase() === selectedPnLAsset))
      ?.filter(t => t.asset.toUpperCase() !== 'USD' && (t.type==='Buy' || t.type==='Sell')) || [];
    
    // Filter assets for calculation
    const relevantAssets = selectedPnLAsset === 'ALL' ? assets : [selectedPnLAsset];

    // Prepare transactions grouped by date per asset with unit price
    type TxEnriched = { asset: string; type: 'Buy'|'Sell'; units: number; unitPrice: number };
    const txByDate = new Map<string, TxEnriched[]>();
    for (const t of filteredTxs.filter(t=> t.asset.toUpperCase() !== 'USD' && (t.type==='Buy' || t.type==='Sell'))) {
      const asset = t.asset.toUpperCase();
      const day = new Date(new Date(t.datetime).getFullYear(), new Date(t.datetime).getMonth(), new Date(t.datetime).getDate()).toISOString().slice(0, 10);
      const key = day;
      const fallback = priceMap.get(day + '|' + asset) ?? 0;
      const unitPrice = (t.priceUsd != null ? t.priceUsd : fallback) || 0;
      const units = Math.abs(t.quantity);
      const arr = txByDate.get(key) || [];
      arr.push({ asset, type: t.type as 'Buy'|'Sell', units, unitPrice });
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

  // Cost Basis vs Portfolio Valuation Over Time
  const costVsValuation = useMemo(() => {
    if (!hist || !hist.prices || assets.length === 0 || !txs || txs.length === 0) {
      return { dates: [] as string[], costBasis: [] as number[], portfolioValue: [] as number[] };
    }

    const dates = hist.prices.map(p => p.date).sort();
    const costBasis: number[] = [];
    const portfolioValue: number[] = [];

    // Calculate cumulative cost basis and portfolio value for each date
    dates.forEach(date => {
      // Calculate cost basis up to this date (deposits - withdrawals)
      let cumulativeCost = 0;
      const fiatCurrencies = getFiatCurrencies();
      
      // Initialize cost tracking for each fiat currency
      const costByCurrency: Record<string, number> = {};
      fiatCurrencies.forEach(currency => {
        costByCurrency[currency] = 0;
      });

      // Process all transactions up to this date
      txs.filter(tx => new Date(tx.datetime) <= new Date(date)).forEach(tx => {
        if (tx.type === 'Deposit') {
          if (isFiatCurrency(tx.asset)) {
            costByCurrency[tx.asset] += tx.quantity;
          }
        } else if (tx.type === 'Withdrawal') {
          if (isFiatCurrency(tx.asset)) {
            costByCurrency[tx.asset] -= tx.quantity;
          }
        }
        // Note: Buy/Sell transactions don't affect cost basis directly
        // as they represent exchanges between assets, not new money invested
      });

      // Convert all fiat costs to USD and sum
      for (const [currency, amount] of Object.entries(costByCurrency)) {
        cumulativeCost += convertFiat(amount, currency, 'USD');
      }

      // Calculate portfolio value at this date
      let portfolioVal = 0;
      
      // Calculate historical crypto holdings up to this date
      const historicalHoldings: Record<string, number> = {};
      assets.forEach(asset => {
        historicalHoldings[asset] = 0;
      });

      // Process all transactions up to this date to calculate holdings
      txs.filter(tx => new Date(tx.datetime) <= new Date(date)).forEach(tx => {
        if (tx.type === 'Buy') {
          historicalHoldings[tx.asset] = (historicalHoldings[tx.asset] || 0) + tx.quantity;
        } else if (tx.type === 'Sell') {
          historicalHoldings[tx.asset] = (historicalHoldings[tx.asset] || 0) - tx.quantity;
        }
      });

      // Add crypto holdings value at this date
      assets.forEach(asset => {
        const assetUnits = historicalHoldings[asset];
        if (assetUnits && assetUnits > 0) {
          const pricePoint = hist.prices.find(p => p.asset === asset && p.date === date);
          if (pricePoint) {
            portfolioVal += assetUnits * pricePoint.price_usd;
          }
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
  }, [hist, txs, assets]);

  // Total Net Worth Over Time (Crypto + Cash)
  const netWorthOverTime = useMemo(() => {
    if (!hist || !hist.prices || assets.length === 0 || !txs || txs.length === 0) {
      return { dates: [] as string[], cryptoValue: [] as number[], cashValue: [] as number[], totalValue: [] as number[] };
    }

    const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
    const cryptoValues: number[] = [];
    const cashValues: number[] = [];
    const totalValues: number[] = [];

    for (const date of dates) {
      // Calculate crypto portfolio value for this date using historical positions
      let cryptoValue = 0;
      for (const asset of assets) {
        const price = hist.prices.find(p => p.date === date && p.asset === asset)?.price_usd || 0;
        
        // Calculate position at this historical date
        let position = 0;
        const relevantTxs = txs.filter(tx => 
          tx.asset.toUpperCase() === asset && 
          (tx.type === 'Buy' || tx.type === 'Sell') &&
          new Date(tx.datetime) <= new Date(date + 'T23:59:59')
        );
        
        for (const tx of relevantTxs) {
          if (tx.type === 'Buy') {
            position += tx.quantity;
          } else if (tx.type === 'Sell') {
            position -= tx.quantity;
          }
        }
        
        cryptoValue += position * price;
      }

      // Calculate cash balance up to this date (including crypto purchases/sales)
      let cashValue = 0;
      const fiatCurrencies = getFiatCurrencies();
      const balances: Record<string, number> = {};
      
      // Initialize balances
      fiatCurrencies.forEach(currency => {
        balances[currency] = 0;
      });
      
      // Process all transactions up to this date
      const relevantTxs = txs.filter(tx => 
        new Date(tx.datetime) <= new Date(date + 'T23:59:59')
      );
      
      for (const tx of relevantTxs) {
        const asset = tx.asset.toUpperCase();
        
        if (fiatCurrencies.includes(asset)) {
          // Handle fiat currency transactions
          if (tx.type === 'Deposit') {
            balances[asset] += tx.quantity;
          } else if (tx.type === 'Withdrawal') {
            balances[asset] -= tx.quantity;
          }
        } else if (tx.type === 'Buy') {
          // Handle crypto purchases - deduct from cash balance
          const costUsd = tx.costUsd || (tx.priceUsd ? tx.priceUsd * tx.quantity : 0);
          if (costUsd > 0) {
            balances['USD'] -= costUsd;
          }
        } else if (tx.type === 'Sell') {
          // Handle crypto sales - add to cash balance
          const proceedsUsd = tx.proceedsUsd || (tx.priceUsd ? tx.priceUsd * tx.quantity : 0);
          if (proceedsUsd > 0) {
            balances['USD'] += proceedsUsd;
          }
        }
      }
      
      // Convert all balances to USD
      for (const [currency, balance] of Object.entries(balances)) {
        cashValue += convertFiat(balance, currency, 'USD');
      }

      const totalValue = cryptoValue + cashValue;
      
      cryptoValues.push(cryptoValue);
      cashValues.push(cashValue);
      totalValues.push(totalValue);
    }

    return { dates, cryptoValue: cryptoValues, cashValue: cashValues, totalValue: totalValues };
  }, [hist, assets, holdings, txs]);

  // Cost basis vs market price for selected asset
  const costVsPrice = useMemo(() => {
    if (!hist || !hist.prices || !selectedAsset) return { dates: [] as string[], avgCost: [] as number[], price: [] as number[] };
    const asset = selectedAsset.toUpperCase();
    const dates = Array.from(new Set(hist.prices.filter(p => p.asset.toUpperCase() === asset).map(p => p.date))).sort();
    // build tx map for this asset
    const txsA = (txs || []).filter(t => t.asset.toUpperCase() === asset && (t.type==='Buy' || t.type==='Sell'))
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
    
    // Calculate crypto holdings
    const cryptoPoints = Object.entries(holdings)
      .map(([a, units])=> {
        const price = curr.prices![a] || 0;
        return { asset: a, units, value: price * units };
      })
      .filter(p=> p.value>0);
    
    // Add cash if there's a positive balance
    const points = [...cryptoPoints];
    if (totalCashBalanceUsd > 0) {
      points.push({ asset: 'Cash', units: totalCashBalanceUsd, value: totalCashBalanceUsd });
    }
    
    const labels = points.map(p=>p.asset);
    const data: Data[] = [{ 
      type:'pie', 
      labels, 
      values: points.map(p=>p.value), 
      customdata: points.map(p=> [p.units]),
      hovertemplate: '<b>%{label}</b><br>Holdings: %{customdata[0]:.6f}<br>Value: %{value:$,.2f}<extra></extra>',
      hole:0.45, 
      marker: { colors: labels.map(a => a === 'Cash' ? '#16a34a' : colorFor(a)) } 
    } as unknown as Data];
    const layout: Partial<Layout> = { autosize:true, height:320, margin:{ t:30, r:10, l:10, b:10 } };
    return { data, layout };
  }, [curr, holdings, colorFor, totalCashBalanceUsd]);


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
            // For sells, use average cost method
            if (totalQuantity > 0) {
              const currentAvgCost = totalCostUsd / totalQuantity;
              const unitsToSell = Math.min(quantity, totalQuantity);
              totalCostUsd -= unitsToSell * currentAvgCost;
              totalQuantity -= unitsToSell;
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
            const quantity = Math.abs(tx.quantity);
            const txDate = new Date(tx.datetime).toISOString().slice(0, 10);
            const btcPriceAtTx = priceMap.get(txDate + '|' + 'BTC') || currentBtcPrice; // Use BTC price at transaction time
            
            if (tx.type === 'Buy') {
              const costUsd = quantity * (tx.priceUsd || 0);
              const btcQuantity = costUsd / btcPriceAtTx;
              totalBtcQuantity += btcQuantity;
              totalBtcCostUsd += costUsd;
            } else {
              // For sells, reduce BTC position using average cost method
              if (totalBtcQuantity > 0) {
                const currentAvgBtcCost = totalBtcCostUsd / totalBtcQuantity;
                const costUsd = quantity * (tx.priceUsd || 0);
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


  // Portfolio Gains/Losses Heatmap
  const portfolioHeatmap = useMemo(() => {
    if (!txs || txs.length === 0 || !hist || !hist.prices) {
      return { assets: [] as string[], pnlValues: [] as number[], colors: [] as string[] };
    }
    
    const priceMap = new Map<string, number>();
    for (const p of hist.prices) priceMap.set(p.date + '|' + p.asset.toUpperCase(), p.price_usd);
    
    // Get the most recent date for current prices
    const dates = Array.from(new Set(hist.prices.map(p => p.date))).sort();
    const latestDate = dates[dates.length - 1];
    
    // Calculate reference date based on timeframe
    let referenceDate = latestDate;
    if (heatmapTimeframe !== 'current') {
      const daysBack = heatmapTimeframe === '24h' ? 1 : heatmapTimeframe === '7d' ? 7 : 30;
      const referenceIndex = Math.max(0, dates.length - daysBack - 1);
      referenceDate = dates[referenceIndex];
    }
    
    const heatmapData: { asset: string; pnl: number; color: string }[] = [];
    
    for (const asset of assets) {
      // Calculate current position and cost basis for this asset
      const assetTxs = txs.filter(tx => tx.asset.toUpperCase() === asset);
      
      let totalQuantity = 0;
      let totalCostUsd = 0;
      
      for (const tx of assetTxs) {
        const quantity = Math.abs(tx.quantity);
        if (tx.type === 'Buy') {
          totalQuantity += quantity;
          totalCostUsd += quantity * (tx.priceUsd || 0);
        } else {
          // For sells, use average cost method
          if (totalQuantity > 0) {
            const currentAvgCost = totalCostUsd / totalQuantity;
            const unitsToSell = Math.min(quantity, totalQuantity);
            totalCostUsd -= unitsToSell * currentAvgCost;
            totalQuantity -= unitsToSell;
          }
        }
      }
      
      // Calculate PnL based on timeframe
      let pnl: number;
      if (heatmapTimeframe === 'current') {
        // Current total PnL
        const currentPrice = priceMap.get(latestDate + '|' + asset) || 0;
        const currentValueUsd = totalQuantity * currentPrice;
        pnl = currentValueUsd - totalCostUsd;
      } else {
        // PnL change over the specified period
        const currentPrice = priceMap.get(latestDate + '|' + asset) || 0;
        const referencePrice = priceMap.get(referenceDate + '|' + asset) || currentPrice;
        const currentValueUsd = totalQuantity * currentPrice;
        const referenceValueUsd = totalQuantity * referencePrice;
        pnl = currentValueUsd - referenceValueUsd;
      }
      
      // Determine color based on PnL (green for positive, red for negative)
      const color = pnl >= 0 ? '#16a34a' : '#dc2626';
      
      heatmapData.push({
        asset,
        pnl,
        color
      });
    }
    
    // Sort by absolute PnL value (largest first)
    heatmapData.sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
    
    return {
      assets: heatmapData.map(d => d.asset),
      pnlValues: heatmapData.map(d => d.pnl),
      colors: heatmapData.map(d => d.color)
    };
  }, [txs, hist, assets, heatmapTimeframe]);


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
          <div className="label">Cash Balance</div>
          <div className="value" style={{ color: '#10b981' }}>${totalCashBalanceUsd.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
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
        <section className="card">
          <div className="card-header">
            <div className="card-title">
              <h2>Portfolio Allocation (Crypto + Cash)</h2>
              <button 
                onClick={() => alert(`Portfolio Allocation (Crypto + Cash)

This pie chart shows how your total portfolio is distributed across different assets.

• Each slice represents an asset's percentage of your total portfolio value
• Includes both cryptocurrency holdings and cash balances
• Cash slice shows total fiat currency balance (USD, EUR, RON converted to USD)
• Hover over slices to see exact percentages and values
• Colors are assigned to each asset for easy identification

This gives you a complete picture of your total portfolio composition.`)}
                className="icon-btn"
                title="Chart Information"
              >
                ℹ️
              </button>
            </div>
          </div>
          {(loadingCurr && assets.length>0) && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>Loading allocation...</div>
          )}
          {!loadingCurr && allocationFigure.data.length === 0 && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>No allocation data</div>
          )}
          {!loadingCurr && allocationFigure.data.length > 0 && (
            <Plot data={allocationFigure.data} layout={allocationFigure.layout} style={{ width:'100%' }} />
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <div className="card-title">
              <h2>Total Net Worth Over Time</h2>
              <button 
                onClick={() => alert(`Total Net Worth Over Time

This chart shows your complete financial picture over time, including both crypto and cash.

• Blue line = Total portfolio value (crypto + cash)
• Orange line = Crypto portfolio value only
• Green line = Cash balance over time
• Shows the impact of deposits/withdrawals on your total wealth

This gives you the most complete view of your financial progress.`)}
                className="icon-btn"
                title="Chart Information"
              >
                ℹ️
              </button>
            </div>
          </div>
          {(loadingTxs || loadingHist) && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>Loading net worth data...</div>
          )}
          {!loadingTxs && !loadingHist && netWorthOverTime.dates.length === 0 && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>No net worth data</div>
          )}
          {!loadingTxs && !loadingHist && netWorthOverTime.dates.length > 0 && (
            <Plot 
              data={[
                {
                  x: netWorthOverTime.dates,
                  y: netWorthOverTime.totalValue,
                  type: 'scatter',
                  mode: 'lines',
                  name: 'Total Net Worth',
                  line: { color: '#3b82f6', width: 3 },
                },
                {
                  x: netWorthOverTime.dates,
                  y: netWorthOverTime.cryptoValue,
                  type: 'scatter',
                  mode: 'lines',
                  name: 'Crypto Value',
                  line: { color: '#f59e0b', width: 2 },
                },
                {
                  x: netWorthOverTime.dates,
                  y: netWorthOverTime.cashValue,
                  type: 'scatter',
                  mode: 'lines',
                  name: 'Cash Balance',
                  line: { color: '#10b981', width: 2 },
                },
              ]}
              layout={{
                title: { text: 'Total Net Worth Over Time' },
                xaxis: { title: { text: 'Date' } },
                yaxis: { title: { text: 'Value (USD)' } },
                height: 400,
                hovermode: 'x unified',
              }}
              style={{ width: '100%' }}
            />
          )}
        </section>
      </div>

      {/* Second Row: Performance Analysis */}
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <section className="card">
          <div className="card-header">
            <div className="card-title">
              <h2>Cost Basis vs Portfolio Valuation</h2>
              <button 
                onClick={() => alert(`Cost Basis vs Portfolio Valuation

This chart compares the total money you've invested (cost basis) with your current portfolio value over time.

• Blue line = Portfolio valuation (current market value)
• Red line = Cost basis (total deposits - withdrawals)
• Green area = Profit (when portfolio value > cost basis)
• Red area = Loss (when portfolio value < cost basis)

Cost basis represents the actual money you've put into your portfolio through deposits, minus any withdrawals. This shows your true investment performance - how much your money has grown or shrunk over time.

This is different from trading P&L as it focuses on your total investment vs. total value, not individual buy/sell transactions.`)}
                className="icon-btn"
                title="Chart Information"
              >
                ℹ️
              </button>
            </div>
          </div>
          {(loadingTxs || loadingHist) && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>Loading cost vs valuation data...</div>
          )}
          {!loadingTxs && !loadingHist && costVsValuation.dates.length === 0 && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>No cost vs valuation data</div>
          )}
          {!loadingTxs && !loadingHist && costVsValuation.dates.length > 0 && (
            <Plot 
              data={[
                {
                  x: costVsValuation.dates,
                  y: costVsValuation.portfolioValue,
                  type: 'scatter',
                  mode: 'lines',
                  name: 'Portfolio Value',
                  line: { color: '#3b82f6', width: 3 },
                  fill: 'tonexty',
                  fillcolor: 'rgba(59, 130, 246, 0.1)',
                },
                {
                  x: costVsValuation.dates,
                  y: costVsValuation.costBasis,
                  type: 'scatter',
                  mode: 'lines',
                  name: 'Cost Basis',
                  line: { color: '#dc2626', width: 3 },
                  fill: 'tozeroy',
                  fillcolor: 'rgba(220, 38, 38, 0.1)',
                },
              ]}
              layout={{
                title: { text: 'Cost Basis vs Portfolio Valuation' },
                xaxis: { title: { text: 'Date' } },
                yaxis: { title: { text: 'Value (USD)' } },
                height: 400,
                hovermode: 'x unified',
                showlegend: true,
              }}
              style={{ width: '100%' }}
            />
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <div className="card-title">
              <h2>PnL over time</h2>
              <button 
                onClick={() => alert(`PnL Over Time

This chart shows your profit and loss (PnL) over time, split into realized and unrealized gains/losses.

• Realized PnL: Profits/losses from completed transactions (buys/sells)
• Unrealized PnL: Current paper gains/losses on held positions
• Green lines = positive PnL (profits)
• Red lines = negative PnL (losses)
• Total PnL = Realized + Unrealized

Use the asset filter to view PnL for specific assets or the entire portfolio.

This helps track your trading performance and understand when gains were realized vs. held.`)}
                className="icon-btn"
                title="Chart Information"
              >
                ℹ️
              </button>
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>Asset
              <select value={selectedPnLAsset} onChange={e=>setSelectedPnLAsset(e.target.value)}>
                <option value="ALL">All Assets (Portfolio)</option>
                {assets.map(a=> (<option key={a} value={a}>{a}</option>))}
              </select>
            </label>
          </div>
          {(loadingTxs || loadingHist) && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>Loading PnL...</div>
          )}
          {!loadingTxs && !loadingHist && pnl.dates.length === 0 && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>No PnL data</div>
          )}
          {!loadingTxs && !loadingHist && pnl.dates.length > 0 && (
          <Plot
            data={[
              { x: pnl.dates, y: pnl.realized, type:'scatter', mode:'lines', name:'Realized' },
              { x: pnl.dates, y: pnl.unrealized, type:'scatter', mode:'lines', name:'Unrealized' },
            ] as Data[]}
            layout={{ autosize:true, height:320, margin:{ t:30, r:10, l:40, b:40 }, legend:{ orientation:'h' } }}
            style={{ width:'100%' }}
          />
          )}
        </section>
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
              <h2>Average cost vs market price ({selectedAsset || '...'})</h2>
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
          {(loadingHist || !selectedAsset) && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>Loading cost vs price...</div>
          )}
          {!loadingHist && costVsPrice.dates.length === 0 && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>No data for selected asset</div>
          )}
          {!loadingHist && costVsPrice.dates.length > 0 && (
          <Plot
            data={[
              { x: costVsPrice.dates, y: costVsPrice.avgCost, type:'scatter', mode:'lines', name:'Avg cost', line: { color: '#888888', dash: 'dot' } },
              { x: costVsPrice.dates, y: costVsPrice.price, type:'scatter', mode:'lines', name:'Market price', line: { color: colorFor(selectedAsset||'') } },
            ] as Data[]}
            layout={{ autosize:true, height:320, margin:{ t:30, r:10, l:40, b:40 }, legend:{ orientation:'h' } }}
            style={{ width:'100%' }}
          />
          )}
        </section>
      </div>

      {/* Fourth Row: Portfolio Value Stacked */}
      <section className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">
            <h2>Portfolio value over time (stacked)</h2>
            <button 
              onClick={() => alert(`Portfolio Value Over Time (Stacked)

This chart shows your total portfolio value broken down by asset over time.

• Each colored area represents an asset's contribution to total value
• The height of each area shows the USD value of that asset
• The total height = your complete portfolio value
• Stacked areas show how your portfolio composition has evolved
• Hover to see exact values for each asset at any point

This helps visualize portfolio growth and asset allocation changes over time.`)}
              className="icon-btn"
              title="Chart Information"
            >
              ℹ️
            </button>
          </div>
        </div>
        {loadingHist && (
          <div style={{ padding: 16, color: 'var(--muted)' }}>Loading portfolio value...</div>
        )}
        {!loadingHist && stacked.series.length === 0 && (
          <div style={{ padding: 16, color: 'var(--muted)' }}>No historical data</div>
        )}
        {!loadingHist && stacked.series.length > 0 && (
          <Plot data={stacked.series} layout={{ autosize:true, height:340, margin:{ t:30, r:10, l:40, b:40 }, legend:{ orientation:'h' }, hovermode: 'x unified' }} style={{ width:'100%' }} />
        )}
      </section>

      {/* Fifth Row: BTC Analysis */}
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <section className="card">
          <div className="card-header">
            <div className="card-title">
              <h2>BTC Ratio & Accumulation</h2>
              <button 
                onClick={() => alert(`BTC Ratio & Accumulation

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

Use the chart type selector to switch between views.`)}
                className="icon-btn"
                title="Chart Information"
              >
                ℹ️
              </button>
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>Chart Type
              <select value={selectedBtcChart} onChange={e=>setSelectedBtcChart(e.target.value)}>
                <option value="ratio">BTC Ratio (%)</option>
                <option value="accumulation">BTC Accumulation</option>
              </select>
            </label>
          </div>
          {(loadingHist || loadingTxs) && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>Loading BTC charts...</div>
          )}
          {!loadingHist && !loadingTxs && (selectedBtcChart === 'ratio' ? (
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
          ))}
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
          {(loadingHist || loadingTxs) && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>Loading performance...</div>
          )}
          {!loadingHist && !loadingTxs && altcoinVsBtc.dates.length === 0 && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>No performance data</div>
          )}
          {!loadingHist && !loadingTxs && altcoinVsBtc.dates.length > 0 && (
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
          )}
        </section>
      </div>

      {/* Sixth Row: Advanced Analysis */}
      <div className="grid grid-2" style={{ marginBottom: 16 }}>
        <section className="card">
          <div className="card-header">
            <div className="card-title">
              <h2>Profit-Taking Opportunities (Altcoin vs BTC PnL)</h2>
              <button 
                onClick={() => alert(`Profit-Taking Opportunities

This chart compares your altcoin PnL vs what BTC PnL would be if you had bought Bitcoin instead.

• Solid line = Your altcoin PnL (actual performance)
• Dashed line = BTC PnL (what you would have made with BTC)
• When altcoin line > BTC line = altcoin outperforming BTC
• When BTC line > altcoin line = BTC would have been better
• Only shows comparison when you have an active position

This helps identify when to take profits on altcoins vs holding BTC longer.

Use the asset selector to compare different altcoins.`)}
                className="icon-btn"
                title="Chart Information"
              >
                ℹ️
              </button>
            </div>
          </div>
          <div style={{ marginBottom: 8 }}>
            <label style={{ display:'inline-flex', alignItems:'center', gap:8 }}>Asset
              <select value={selectedProfitAsset} onChange={e=>setSelectedProfitAsset(e.target.value)}>
                <option value="ALL">All Assets</option>
                {assets.filter(a => a !== 'BTC').map(a=> (<option key={a} value={a}>{a}</option>))}
              </select>
            </label>
          </div>
          {(loadingHist || loadingTxs) && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>Loading opportunities...</div>
          )}
          {!loadingHist && !loadingTxs && profitOpportunities.dates.length === 0 && (
            <div style={{ padding: 16, color: 'var(--muted)' }}>No opportunities data</div>
          )}
          {!loadingHist && !loadingTxs && profitOpportunities.dates.length > 0 && (
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
          )}
        </section>
      </div>
    </main>
  );
}
