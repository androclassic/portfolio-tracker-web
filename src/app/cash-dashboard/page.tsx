'use client';
import useSWR from 'swr';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePortfolio } from '../PortfolioProvider';
import { getAssetColor, getFiatCurrencies, convertFiat } from '@/lib/assets';
import AuthGuard from '@/components/AuthGuard';
import { PlotlyChart as Plot } from '@/components/charts/plotly/PlotlyChart';
import { ChartCard } from '@/components/ChartCard';
import { startIsoForTimeframe } from '@/lib/timeframe';
import CryptoIcon from '../components/CryptoIcon';

import type { Layout, Data } from 'plotly.js';
import { jsonFetcher } from '@/lib/swr-fetcher';
import type { Transaction as Tx } from '@/lib/types';
import type { RomaniaTaxReport, TaxableEvent, BuyLotTrace } from '@/lib/tax/romania-v2';

type BuyLotTraceWithFundingSells = BuyLotTrace & {
  fundingSells?: Array<{ asset: string; amountUsd: number; costBasisUsd?: number; saleTransactionId: number; saleDatetime: string }>;
  cashSpentUsd?: number;
};

const fetcher = jsonFetcher;

/**
 * Convert taxable event source trace to Sankey diagram format
 */
function createSankeyData(event: TaxableEvent, transactions?: Tx[]): { data: Data[]; layout: Partial<Layout> } {
  const sourceTrace = event.sourceTrace;
  
  if (sourceTrace.length === 0) {
    return {
      data: [] as Data[],
      layout: { title: { text: 'No source data available' } }
    };
  }

  // Prefer rich trace: Deposits -> Buys -> Sells -> Withdrawal (use deep trace if available)
  const saleTrace = (event.saleTraceDeep && event.saleTraceDeep.length ? event.saleTraceDeep : event.saleTrace) || [];
  
  // Build a map of swap information from sourceTrace (in case it's missing from saleTrace buy lots)
  const swapInfoByBuyTxId = new Map<number, { swappedFromAsset?: string; swappedFromQuantity?: number; swappedFromTransactionId?: number }>();
  // Also build a map of original buy lots from sourceTrace (for swaps that came from other crypto)
  const originalBuyLotsBySwapTxId = new Map<number, Array<{ buyTransactionId: number; buyDatetime: string; asset: string; quantity: number; costBasisUsd: number }>>();
  
  for (const trace of sourceTrace) {
    if (trace.swappedFromAsset && trace.transactionId) {
      swapInfoByBuyTxId.set(trace.transactionId, {
        swappedFromAsset: trace.swappedFromAsset,
        swappedFromQuantity: trace.swappedFromQuantity,
        swappedFromTransactionId: trace.swappedFromTransactionId,
      });
    }
  }
  
  // Look through sourceTrace to find original buy lots that were swapped
  // For each swap transaction, find the original buy lots that came before it
  for (let i = 0; i < sourceTrace.length; i++) {
    const trace = sourceTrace[i];
    if (trace.swappedFromAsset && (trace.type === 'CryptoSwap' || trace.type === 'Swap')) {
      // This is a swap (e.g., SOL → ADA, transaction 4)
      // Look for the original buy lots that came before it (e.g., Buy SOL, transaction 3)
      const originalLots: Array<{ buyTransactionId: number; buyDatetime: string; asset: string; quantity: number; costBasisUsd: number }> = [];
      for (let j = 0; j < i; j++) {
        const prevTrace = sourceTrace[j];
        // Match if the previous trace is the asset we swapped from
        // Only match if it's not itself a swap (to get the original buy, not intermediate swaps)
        if (prevTrace.asset === trace.swappedFromAsset && 
            prevTrace.transactionId && 
            !prevTrace.swappedFromAsset) {
          // This is the original buy (e.g., Buy SOL from USDC, not a swap)
          originalLots.push({
            buyTransactionId: prevTrace.transactionId,
            buyDatetime: prevTrace.datetime,
            asset: prevTrace.asset,
            quantity: prevTrace.quantity,
            costBasisUsd: prevTrace.costBasisUsd,
          });
        }
      }
      if (originalLots.length > 0) {
        originalBuyLotsBySwapTxId.set(trace.transactionId, originalLots);
      }
    }
  }
  
  if (saleTrace.length > 0) {
    // Transaction-level flow (no loops): Deposits -> Buys -> Sells -> Withdrawal, plus Sell -> Buy funding hops.
    // This avoids cycles that appear when you aggregate by asset (e.g., sell BTC then later buy BTC again).
    const nodes: string[] = [];
    const nodeHover: string[] = [];
    const nodeIndex = new Map<string, number>();

    const ensure = (key: string, label: string, hover: string) => {
      const ex = nodeIndex.get(key);
      if (ex !== undefined) return ex;
      const idx = nodes.length;
      nodes.push(label);
      nodeHover.push(hover);
      nodeIndex.set(key, idx);
      return idx;
    };

    const withdrawalIdx = ensure(
      'withdrawal',
      'Withdrawal',
      [
        `<b>Withdrawal</b>`,
        `Tx: ${event.transactionId}`,
        `Date: ${new Date(event.datetime).toISOString().slice(0, 10)}`,
        `Amount: $${event.fiatAmountUsd.toFixed(2)}`,
        `Cost basis: $${event.costBasisUsd.toFixed(2)}`,
        `Net P/L: ${event.gainLossUsd >= 0 ? '+' : ''}$${event.gainLossUsd.toFixed(2)}`,
      ].join('<br>')
    );

    const depositsIdx = ensure(
      'deposits',
      'Deposits',
      '<b>Deposits</b><br>Aggregated fiat funding'
    );

    type Edge = { from: number; to: number; value: number; hover: string; color: string };
    const edgeMap = new Map<string, Edge>();
    const addEdge = (from: number, to: number, value: number, hover: string, color: string) => {
      if (!Number.isFinite(value) || value <= 0) return;
      const key = `${from}->${to}`;
      const prev = edgeMap.get(key);
      if (!prev) edgeMap.set(key, { from, to, value, hover, color });
      else prev.value += value;
    };

    // Create Sell nodes and connect to Withdrawal
    saleTrace.forEach((sale) => {
      const sellKey = `sell:${sale.saleTransactionId}`;
      const sellDate = new Date(sale.saleDatetime).toISOString().slice(0, 10);
      const sellIdx = ensure(
        sellKey,
        `Sell ${sale.asset} #${sale.saleTransactionId}`,
        [
          `<b>Sell ${sale.asset}</b>`,
          `Tx: ${sale.saleTransactionId}`,
          `Date: ${sellDate}`,
          `Allocated proceeds: $${sale.proceedsUsd.toFixed(2)}`,
          `Allocated basis: $${sale.costBasisUsd.toFixed(2)}`,
          `Allocated P/L: ${sale.gainLossUsd >= 0 ? '+' : ''}$${sale.gainLossUsd.toFixed(2)}`,
        ].join('<br>')
      );

      addEdge(
        sellIdx,
        withdrawalIdx,
        sale.proceedsUsd,
        `<b>Sell → Withdrawal</b><br>Proceeds: $${sale.proceedsUsd.toFixed(2)}`,
        sale.gainLossUsd >= 0 ? '#10b981' : '#ef4444'
      );

      // Create Buy nodes and connect Buy -> Sell (what got sold)
      const saleBasis = sale.costBasisUsd;
      sale.buyLots.forEach((lot) => {
        const buyKey = `buy:${lot.buyTransactionId}`;
        const buyDate = new Date(lot.buyDatetime).toISOString().slice(0, 10);
        
        // Check if this buy came from a swap (crypto-to-crypto or stablecoin-to-crypto)
        // A swap is detected if swappedFromAsset exists and is different from the current asset
        // If swap info is missing from the lot, try to get it from sourceTrace
        let swappedFromAsset = lot.swappedFromAsset;
        let swappedFromQuantity = lot.swappedFromQuantity;
        let swappedFromTransactionId = lot.swappedFromTransactionId;
        
        if (!swappedFromAsset) {
          const swapInfo = swapInfoByBuyTxId.get(lot.buyTransactionId);
          if (swapInfo) {
            swappedFromAsset = swapInfo.swappedFromAsset;
            swappedFromQuantity = swapInfo.swappedFromQuantity;
            swappedFromTransactionId = swapInfo.swappedFromTransactionId;
          }
        }
        
        const isSwap = swappedFromAsset && swappedFromAsset !== lot.asset;
        
        const buyIdx = ensure(
          buyKey,
          isSwap ? `Swap ${swappedFromAsset}→${lot.asset} #${lot.buyTransactionId}` : `Buy ${lot.asset} #${lot.buyTransactionId}`,
          [
            isSwap ? `<b>Swap ${swappedFromAsset} → ${lot.asset}</b>` : `<b>Buy ${lot.asset}</b>`,
            `Tx: ${lot.buyTransactionId}`,
            `Date: ${buyDate}`,
            isSwap ? (() => {
              // Look up original transaction to get actual quantities (not scaled from sale)
              const originalTx = transactions?.find((t: Tx) => t.id === lot.buyTransactionId);
              const fromQty = originalTx?.fromQuantity || swappedFromQuantity || 0;
              const toQty = originalTx?.toQuantity || lot.quantity;
              return `Swapped ${fromQty.toFixed(8)} ${swappedFromAsset} → ${toQty.toFixed(8)} ${lot.asset}`;
            })() : `Qty (sold from lot): ${lot.quantity.toFixed(8)}`,
            `Allocated basis: $${lot.costBasisUsd.toFixed(2)}`,
          ].join('<br>')
        );

        const lotProceedsShare =
          saleBasis > 0
            ? (sale.proceedsUsd * (lot.costBasisUsd / saleBasis))
            : (sale.proceedsUsd / Math.max(1, sale.buyLots.length));

        addEdge(
          buyIdx,
          sellIdx,
          lotProceedsShare,
          `<b>${isSwap ? 'Swap' : 'Buy lot'} → Sell</b><br>Attributed proceeds: $${lotProceedsShare.toFixed(2)}`,
          getAssetColor(lot.asset)
        );

        // If this is a swap, show the swap chain: original buy lots -> swap -> this buy
        if (isSwap) {
          // Prefer originalBuyLotsBySwapTxId (from sourceTrace with original values) over swappedFromBuyLots (scaled)
          // This ensures we show the correct original transaction quantities (e.g., 10 SOL @ $1000, not 5 SOL @ $500)
          let swappedFromBuyLots = originalBuyLotsBySwapTxId.get(lot.buyTransactionId);
          
          // Fall back to swappedFromBuyLots if not found in sourceTrace
          if (!swappedFromBuyLots || swappedFromBuyLots.length === 0) {
            swappedFromBuyLots = lot.swappedFromBuyLots;
          }
          
          if (swappedFromBuyLots && swappedFromBuyLots.length > 0) {
            // Show full chain: original buy lots → swap → this buy
            // Calculate scale based on the actual cost basis used (from the lot), not the original buy lot
            const swapInputTotal = swappedFromBuyLots.reduce((sum, bl) => sum + bl.costBasisUsd, 0);
            const swapScale = swapInputTotal > 0 ? (lotProceedsShare / swapInputTotal) : 0;
            
            // Show each original buy lot that was swapped (e.g., SOL buy lots that were swapped to ADA)
            swappedFromBuyLots.forEach((originalLot) => {
              const originalBuyKey = `buy:${originalLot.buyTransactionId}`;
              const originalBuyDate = new Date(originalLot.buyDatetime).toISOString().split('T')[0];
              const originalBuyIdx = ensure(
                originalBuyKey,
                `Buy ${originalLot.asset} #${originalLot.buyTransactionId}`,
                [
                  `<b>Buy ${originalLot.asset}</b>`,
                  `Tx: ${originalLot.buyTransactionId}`,
                  `Date: ${originalBuyDate}`,
                  `Qty: ${originalLot.quantity.toFixed(8)}`,
                  `Cost basis: $${originalLot.costBasisUsd.toFixed(2)}`,
                ].join('<br>')
              );
              
              addEdge(
                originalBuyIdx,
                buyIdx,
                originalLot.costBasisUsd * swapScale,
                `<b>Buy ${originalLot.asset} → Swap</b><br>${originalLot.asset} buy funded ${swappedFromAsset}→${lot.asset} swap` +
                  `<br>Original basis: $${originalLot.costBasisUsd.toFixed(2)} • Used in this sale: $${(originalLot.costBasisUsd * swapScale).toFixed(2)}`,
                getAssetColor(originalLot.asset)
              );
            });
          } else {
            // Swap without buy lots (e.g., stablecoin → crypto where source came from cash queue)
            // Show connection from deposits to the swap, since the source asset came from cash
            const fundingSells = (lot as BuyLotTraceWithFundingSells).fundingSells ?? [];
            const fundingFromSellsUsd = fundingSells.reduce((sum, x) => sum + (x.amountUsd || 0), 0);
            const cashSpentUsd = (lot as BuyLotTraceWithFundingSells).cashSpentUsd ?? lot.costBasisUsd;
            const depositPortionUsd = Math.max(0, cashSpentUsd - fundingFromSellsUsd);
            const inputTotalUsd = fundingFromSellsUsd + depositPortionUsd;
            const scale = inputTotalUsd > 0 ? (lotProceedsShare / inputTotalUsd) : 0;

            fundingSells.forEach((fs) => {
              const fsKey = `sell:${fs.saleTransactionId}`;
              const fsDate = new Date(fs.saleDatetime).toISOString().split('T')[0];
              const fsIdx = ensure(
                fsKey,
                `Sell ${fs.asset} #${fs.saleTransactionId}`,
                [
                  `<b>Sell ${fs.asset}</b>`,
                  `Tx: ${fs.saleTransactionId}`,
                  `Date: ${fsDate}`,
                ].join('<br>')
              );
              addEdge(
                fsIdx,
                buyIdx,
                fs.amountUsd * scale,
                `<b>Sell → Swap</b><br>${fs.asset} sale #${fs.saleTransactionId} funded ${lot.swappedFromAsset}→${lot.asset} swap` +
                  `<br>Original: $${fs.amountUsd.toFixed(2)} • Used in this sale: $${(fs.amountUsd * scale).toFixed(2)}`,
                getAssetColor(fs.asset)
              );
            });

            if (depositPortionUsd > 0) {
              addEdge(
                depositsIdx,
                buyIdx,
                depositPortionUsd * scale,
                `<b>Deposits → Swap</b><br>${swappedFromAsset}→${lot.asset} swap funded by deposits` +
                  `<br>Original: $${depositPortionUsd.toFixed(2)} • Used in this sale: $${(depositPortionUsd * scale).toFixed(2)}`,
                '#64748b'
              );
            }
          }
          
          // For swaps with buy lots, also show funding sells and deposits if any
          if (lot.swappedFromBuyLots && lot.swappedFromBuyLots.length > 0) {
            const fundingSells = (lot as BuyLotTraceWithFundingSells).fundingSells ?? [];
            const fundingFromSellsUsd = fundingSells.reduce((sum, x) => sum + (x.amountUsd || 0), 0);
            const cashSpentUsd = (lot as BuyLotTraceWithFundingSells).cashSpentUsd ?? lot.costBasisUsd;
            const depositPortionUsd = Math.max(0, cashSpentUsd - fundingFromSellsUsd);
            const inputTotalUsd = fundingFromSellsUsd + depositPortionUsd;
            const swapInputTotal = lot.swappedFromBuyLots.reduce((sum, bl) => sum + bl.costBasisUsd, 0);
            const scale = inputTotalUsd > 0 ? ((swapInputTotal > 0 ? swapInputTotal : lotProceedsShare) / inputTotalUsd) : 0;

            fundingSells.forEach((fs) => {
              const fsKey = `sell:${fs.saleTransactionId}`;
              const fsDate = new Date(fs.saleDatetime).toISOString().split('T')[0];
              const fsIdx = ensure(
                fsKey,
                `Sell ${fs.asset} #${fs.saleTransactionId}`,
                [
                  `<b>Sell ${fs.asset}</b>`,
                  `Tx: ${fs.saleTransactionId}`,
                  `Date: ${fsDate}`,
                ].join('<br>')
              );
              addEdge(
                fsIdx,
                buyIdx,
                fs.amountUsd * scale,
                `<b>Sell → Swap</b><br>${fs.asset} sale #${fs.saleTransactionId} funded ${swappedFromAsset}→${lot.asset} swap` +
                  `<br>Original: $${fs.amountUsd.toFixed(2)} • Used in this sale: $${(fs.amountUsd * scale).toFixed(2)}`,
                getAssetColor(fs.asset)
              );
            });

            if (depositPortionUsd > 0) {
              addEdge(
                depositsIdx,
                buyIdx,
                depositPortionUsd * scale,
                `<b>Deposits → Swap</b><br>Original: $${depositPortionUsd.toFixed(2)} • Used in this sale: $${(depositPortionUsd * scale).toFixed(2)}`,
                '#64748b'
              );
            }
          }
        } else {
          // Regular buy (not from swap): show funding from sells and deposits
          const fundingSells = (lot as BuyLotTraceWithFundingSells).fundingSells ?? [];
          const fundingFromSellsUsd = fundingSells.reduce((sum, x) => sum + (x.amountUsd || 0), 0);
          const cashSpentUsd = (lot as BuyLotTraceWithFundingSells).cashSpentUsd ?? lot.costBasisUsd;
          const depositPortionUsd = Math.max(0, cashSpentUsd - fundingFromSellsUsd);
          // IMPORTANT (visualization): cashSpentUsd (inputs at buy time) will usually differ from lotProceedsShare (outputs at sell time)
          // because price changes create profit/loss. To avoid "empty space" in Sankey nodes, we normalize buy inputs so that
          // (funding sells + deposits) equals the attributed proceeds flowing out of this buy-lot to the sell.
          const inputTotalUsd = fundingFromSellsUsd + depositPortionUsd;
          const scale = inputTotalUsd > 0 ? (lotProceedsShare / inputTotalUsd) : 0;

          fundingSells.forEach((fs) => {
            const fsKey = `sell:${fs.saleTransactionId}`;
            const fsDate = new Date(fs.saleDatetime).toISOString().split("T")[0];
            const fsIdx = ensure(
              fsKey,
              `Sell ${fs.asset} #${fs.saleTransactionId}`,
            [
              `<b>Sell ${fs.asset}</b>`,
              `Tx: ${fs.saleTransactionId}`,
              `Date: ${fsDate}`,
            ].join('<br>')
            );
            addEdge(
              fsIdx,
              buyIdx,
              fs.amountUsd * scale,
                `<b>Sell → Buy</b><br>${fs.asset} sale #${fs.saleTransactionId} funded this buy` +
                  `<br>Original: $${fs.amountUsd.toFixed(2)} • Used in this sale: $${(fs.amountUsd * scale).toFixed(2)}`,
              getAssetColor(fs.asset)
            );
          });

          if (depositPortionUsd > 0) {
            addEdge(
              depositsIdx,
              buyIdx,
              depositPortionUsd * scale,
                `<b>Deposits → Buy</b><br>Original: $${depositPortionUsd.toFixed(2)} • Used in this sale: $${(depositPortionUsd * scale).toFixed(2)}`,
              '#64748b'
            );
          }
        }
      });
    });

    const sources: number[] = [];
    const targets: number[] = [];
    const values: number[] = [];
    const linkHover: string[] = [];
    const colors: string[] = [];
    for (const e of edgeMap.values()) {
      sources.push(e.from);
      targets.push(e.to);
      values.push(e.value);
      linkHover.push(`${e.hover}<br><b>Value</b>: $${e.value.toFixed(2)}`);
      colors.push(e.color);
    }

    const data: Data = {
      type: 'sankey',
      node: {
        pad: 14,
        thickness: 18,
        line: { color: 'black', width: 0.5 },
        label: nodes,
        customdata: nodeHover,
        hovertemplate: '%{customdata}<extra></extra>',
        color: nodes.map((n) => {
          if (n === 'Withdrawal') return event.gainLossUsd >= 0 ? '#10b981' : '#ef4444';
          if (n === 'Deposits') return '#64748b';
          if (n.startsWith('Swap')) return '#f59e0b'; // Orange for swaps
          if (n.startsWith('Buy')) return '#a855f7';
          if (n.startsWith('Sell')) return '#3b82f6';
          return '#94a3b8';
        }),
      },
      link: {
        source: sources,
        target: targets,
        value: values,
        label: values.map(() => ''),
        customdata: linkHover,
        hovertemplate: '%{customdata}<extra></extra>',
        color: colors.map((c) => c + '80'),
      },
    } as Data;

    const layout: Partial<Layout> = {
      title: {
        text:
          `Money flow to withdrawal - ${new Date(event.datetime).toLocaleDateString()}<br>` +
          `<span style="font-size: 12px; color: ${event.gainLossUsd >= 0 ? '#10b981' : '#ef4444'}">` +
          `Net P/L: ${event.gainLossUsd >= 0 ? '+' : ''}$${event.gainLossUsd.toFixed(2)}</span>`,
        font: { size: 14 },
      },
      height: 560,
      font: { size: 10 },
    };

    return { data: [data], layout };
  }

  // Group by asset to aggregate quantities and cost basis
  const assetMap = new Map<string, { quantity: number; costBasis: number; datetime: string }>();
  
  sourceTrace.forEach(trace => {
    const existing = assetMap.get(trace.asset) || { quantity: 0, costBasis: 0, datetime: trace.datetime };
    existing.quantity += trace.quantity;
    existing.costBasis += trace.costBasisUsd;
    assetMap.set(trace.asset, existing);
  });

  // Create nodes: [Sources, Cash (USD), Fiat Withdrawal]
  const nodes: string[] = [];
  const nodeIndices = new Map<string, number>();
  
  // Add original asset nodes
  assetMap.forEach((_, asset) => {
    nodeIndices.set(asset, nodes.length);
    nodes.push(asset);
  });
  
  // Add cash intermediate node
  const cashIndex = nodes.length;
  nodes.push('Cash (USD)');
  nodeIndices.set('Cash', cashIndex);
  
  // Add final fiat withdrawal node
  const fiatIndex = nodes.length;
  nodes.push(`Withdrawal (${event.fiatAmountUsd.toFixed(2)} USD)`);
  nodeIndices.set('Withdrawal', fiatIndex);

  // Create links: [Source -> Cash, Cash -> Fiat]
  const sources: number[] = [];
  const targets: number[] = [];
  const values: number[] = [];
  const labels: string[] = [];
  const colors: string[] = [];

  // Links from sources to cash
  assetMap.forEach((data, asset) => {
    sources.push(nodeIndices.get(asset)!);
    targets.push(cashIndex);
    values.push(data.costBasis); // Use cost basis as flow value
    labels.push(`${asset}: $${data.costBasis.toFixed(2)}`);
    colors.push(getAssetColor(asset));
  });

  // Link from cash to fiat withdrawal
  sources.push(cashIndex);
  targets.push(fiatIndex);
  values.push(event.fiatAmountUsd);
  labels.push(`Withdrawal: $${event.fiatAmountUsd.toFixed(2)}`);
  colors.push(event.gainLossUsd >= 0 ? '#10b981' : '#ef4444');

  const data: Data = {
    type: 'sankey',
    node: {
      pad: 15,
      thickness: 20,
      line: {
        color: 'black',
        width: 0.5
      },
      // Keep labels short; details on hover
      label: nodes.map((n, i) => {
        if (i === fiatIndex) return 'Withdrawal';
        if (i === cashIndex) return 'Cash';
        return n;
      }),
      customdata: nodes.map((n, i) => {
        if (i === fiatIndex) {
          return [
            `<b>Withdrawal</b>`,
            `Amount: $${event.fiatAmountUsd.toFixed(2)}`,
            `Cost basis: $${event.costBasisUsd.toFixed(2)}`,
            `Net P/L: ${event.gainLossUsd >= 0 ? '+' : ''}$${event.gainLossUsd.toFixed(2)}`,
          ].join('<br>');
        }
        if (i === cashIndex) {
          return `<b>Cash (USD)</b><br>Intermediate holding`;
        }
        const d = assetMap.get(n);
        return d
          ? `<b>${n}</b><br>Cost basis: $${d.costBasis.toFixed(2)}<br>Qty: ${d.quantity.toFixed(8)}`
          : `<b>${n}</b>`;
      }),
      hovertemplate: '%{customdata}<extra></extra>',
      color: nodes.map((node, idx) => {
        if (idx === fiatIndex) {
          return event.gainLossUsd >= 0 ? '#10b981' : '#ef4444';
        }
        if (idx === cashIndex) {
          return '#3b82f6';
        }
        return getAssetColor(node);
      })
    },
    link: {
      source: sources,
      target: targets,
      value: values,
      label: labels.map(() => ''),
      customdata: labels.map((l, idx) => `<b>Flow</b><br>${l}<br>Value: $${values[idx].toFixed(2)}`),
      hovertemplate: '%{customdata}<extra></extra>',
      color: colors.map(c => c + '80') // Add transparency
    }
  } as Data;

  const layout: Partial<Layout> = {
    title: {
      text: `Source Flow - ${new Date(event.datetime).toLocaleDateString()}<br>` +
            `<span style="font-size: 12px; color: ${event.gainLossUsd >= 0 ? '#10b981' : '#ef4444'}">` +
            `Gain/Loss: ${event.gainLossUsd >= 0 ? '+' : ''}$${event.gainLossUsd.toFixed(2)}</span>`,
      font: { size: 14 }
    },
    height: 400,
    font: { size: 10 }
  };

  return { data: [data], layout };
}

type SankeyExplorerData = { data: Data[]; layout: Partial<Layout>; nodeKeys: string[] };

function createSankeyExplorerData(event: TaxableEvent, opts: {
  visibleSaleIds: Set<number>;
  visibleBuyIds: Set<number>;
  showDepositTxs: boolean;
  showLabels: boolean;
  nodeThickness: number;
  nodePad: number;
}, transactions?: Tx[]): SankeyExplorerData {
  const sourceTrace = event.sourceTrace;
  const directSales = event.saleTrace || [];
  const deepSales = (event.saleTraceDeep && event.saleTraceDeep.length ? event.saleTraceDeep : directSales) || [];
  
  // Build a map of swap information from sourceTrace (in case it's missing from saleTrace buy lots)
  const swapInfoByBuyTxId = new Map<number, { swappedFromAsset?: string; swappedFromQuantity?: number; swappedFromTransactionId?: number }>();
  // Also build a map of original buy lots from sourceTrace (for swaps that came from other crypto)
  const originalBuyLotsBySwapTxId = new Map<number, Array<{ buyTransactionId: number; buyDatetime: string; asset: string; quantity: number; costBasisUsd: number }>>();
  
  for (const trace of sourceTrace) {
    if (trace.swappedFromAsset && trace.transactionId) {
      swapInfoByBuyTxId.set(trace.transactionId, {
        swappedFromAsset: trace.swappedFromAsset,
        swappedFromQuantity: trace.swappedFromQuantity,
        swappedFromTransactionId: trace.swappedFromTransactionId,
      });
    }
  }
  
  // Look through sourceTrace to find original buy lots that were swapped
  // For each swap transaction, find the original buy lots that came before it
  for (let i = 0; i < sourceTrace.length; i++) {
    const trace = sourceTrace[i];
    if (trace.swappedFromAsset && (trace.type === 'CryptoSwap' || trace.type === 'Swap')) {
      // This is a swap (e.g., SOL → ADA, transaction 4)
      // Look for the original buy lots that came before it (e.g., Buy SOL, transaction 3)
      const originalLots: Array<{ buyTransactionId: number; buyDatetime: string; asset: string; quantity: number; costBasisUsd: number }> = [];
      for (let j = 0; j < i; j++) {
        const prevTrace = sourceTrace[j];
        // Match if the previous trace is the asset we swapped from
        // Only match if it's not itself a swap (to get the original buy, not intermediate swaps)
        if (prevTrace.asset === trace.swappedFromAsset && 
            prevTrace.transactionId && 
            !prevTrace.swappedFromAsset) {
          // This is the original buy (e.g., Buy SOL from USDC, not a swap)
          originalLots.push({
            buyTransactionId: prevTrace.transactionId,
            buyDatetime: prevTrace.datetime,
            asset: prevTrace.asset,
            quantity: prevTrace.quantity,
            costBasisUsd: prevTrace.costBasisUsd,
          });
        }
      }
      if (originalLots.length > 0) {
        originalBuyLotsBySwapTxId.set(trace.transactionId, originalLots);
      }
    }
  }

  const directSaleById = new Map<number, (typeof directSales)[number]>();
  for (const s of directSales) directSaleById.set(s.saleTransactionId, s);
  const deepSaleById = new Map<number, (typeof deepSales)[number]>();
  for (const s of deepSales) deepSaleById.set(s.saleTransactionId, s);

  // Build buy funding sell ids map (for click-to-expand)
  const buyFundingSellIds = new Map<number, number[]>();
  for (const s of deepSales) {
    for (const bl of s.buyLots) {
      const fs = (bl as BuyLotTraceWithFundingSells).fundingSells || [];
      if (!fs.length) continue;
      const prev = buyFundingSellIds.get(bl.buyTransactionId) || [];
      for (const f of fs) prev.push(f.saleTransactionId);
      buyFundingSellIds.set(bl.buyTransactionId, prev);
    }
  }

  const nodes: string[] = [];
  const nodeKeys: string[] = [];
  const nodeHover: string[] = [];
  const nodeIndex = new Map<string, number>();

  const ensure = (key: string, label: string, hover: string) => {
    const ex = nodeIndex.get(key);
    if (ex !== undefined) return ex;
    const idx = nodes.length;
    nodeIndex.set(key, idx);
    nodeKeys.push(key);
    nodes.push(opts.showLabels ? label : (key === 'withdrawal' ? 'Withdrawal' : ''));
    nodeHover.push(hover);
    return idx;
  };

  const withdrawalIdx = ensure(
    'withdrawal',
    'Withdrawal',
    [
      `<b>Withdrawal</b>`,
      `Tx: ${event.transactionId}`,
      `Date: ${new Date(event.datetime).toISOString().slice(0, 10)}`,
      `Amount: $${event.fiatAmountUsd.toFixed(2)}`,
      `Cost basis: $${event.costBasisUsd.toFixed(2)}`,
      `Net P/L: ${event.gainLossUsd >= 0 ? '+' : ''}$${event.gainLossUsd.toFixed(2)}`,
      `<br><b>Tip</b>: Click a Buy node to expand upstream funding sells; click a Sell node to reveal its buy lots.`,
    ].join('<br>')
  );

  type Edge = { from: number; to: number; value: number; hover: string; color: string };
  const edgeMap = new Map<string, Edge>();
  const addEdge = (from: number, to: number, value: number, hover: string, color: string) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const key = `${from}->${to}`;
    const prev = edgeMap.get(key);
    if (!prev) edgeMap.set(key, { from, to, value, hover, color });
    else prev.value += value;
  };

  // Pre-create sell nodes (only visible ones), but always include direct sales (they connect to withdrawal)
  const visibleSales = new Set<number>(opts.visibleSaleIds);
  for (const s of directSales) visibleSales.add(s.saleTransactionId);

  for (const saleId of visibleSales) {
    const s = directSaleById.get(saleId) ?? deepSaleById.get(saleId);
    if (!s) continue;
    ensure(
      `sell:${s.saleTransactionId}`,
      `Sell ${s.asset} #${s.saleTransactionId}`,
      [
        `<b>Sell ${s.asset}</b>`,
        `Tx: ${s.saleTransactionId}`,
        `Date: ${new Date(s.saleDatetime).toISOString().slice(0, 10)}`,
        `Proceeds (portion): $${s.proceedsUsd.toFixed(2)}`,
        `Basis (portion): $${s.costBasisUsd.toFixed(2)}`,
        `P/L (portion): ${s.gainLossUsd >= 0 ? '+' : ''}$${s.gainLossUsd.toFixed(2)}`,
      ].join('<br>')
    );
  }

  // Buy aggregation for consistent inflows (reduces clutter)
  type BuyAgg = {
    buyTransactionId: number;
    asset: string;
    buyDatetime: string;
    outflowBasisUsd: number;
    basisUsd: number;
    fundingSells: Map<number, { saleTransactionId: number; saleDatetime: string; asset: string; amountUsd: number; costBasisUsd: number }>;
    depositByTx: Map<number, { transactionId: number; datetime: string; asset: string; quantity: number; costBasisUsd: number }>;
  };
  const buyAggById = new Map<number, BuyAgg>();
  const ensureBuyAgg = (bl: BuyLotTrace) => {
    const ex = buyAggById.get(bl.buyTransactionId);
    if (ex) return ex;
    const agg: BuyAgg = {
      buyTransactionId: bl.buyTransactionId,
      asset: bl.asset,
      buyDatetime: bl.buyDatetime,
      outflowBasisUsd: 0,
      basisUsd: 0,
      fundingSells: new Map(),
      depositByTx: new Map(),
    };
    buyAggById.set(bl.buyTransactionId, agg);
    return agg;
  };

  // Render sale -> withdrawal edges only for DIRECT sales (SIZED BY COST BASIS)
  for (const s of directSales) {
    if (!visibleSales.has(s.saleTransactionId)) continue;
    const sellIdx = ensure(
      `sell:${s.saleTransactionId}`,
      `Sell ${s.asset} #${s.saleTransactionId}`,
      [
        `<b>Sell ${s.asset}</b>`,
        `Tx: ${s.saleTransactionId}`,
        `Date: ${new Date(s.saleDatetime).toISOString().slice(0, 10)}`,
        `Allocated proceeds: $${s.proceedsUsd.toFixed(2)}`,
        `Allocated basis: $${s.costBasisUsd.toFixed(2)}`,
        `Allocated P/L: ${s.gainLossUsd >= 0 ? '+' : ''}$${s.gainLossUsd.toFixed(2)}`,
      ].join('<br>')
    );
    addEdge(
      sellIdx,
      withdrawalIdx,
      s.costBasisUsd,
      `<b>Sell → Withdrawal</b><br>Cost basis transferred: $${s.costBasisUsd.toFixed(2)}<br>Proceeds: $${s.proceedsUsd.toFixed(2)}`,
      s.gainLossUsd >= 0 ? '#10b981' : '#ef4444'
    );
  }

  // For each visible sale, show its buy lots (only if their buy nodes are visible)
  for (const saleId of visibleSales) {
    const sale = deepSaleById.get(saleId) ?? directSaleById.get(saleId);
    if (!sale) continue;
    const sellIdx = ensure(
      `sell:${sale.saleTransactionId}`,
      `Sell ${sale.asset} #${sale.saleTransactionId}`,
      [
        `<b>Sell ${sale.asset}</b>`,
        `Tx: ${sale.saleTransactionId}`,
        `Date: ${new Date(sale.saleDatetime).toISOString().slice(0, 10)}`,
      ].join('<br>')
    );

    let shownIncomingBasis = 0;
    const saleBasis = sale.costBasisUsd;
    for (const lot of sale.buyLots) {
      if (!opts.visibleBuyIds.has(lot.buyTransactionId)) continue;
      
      // Check if this buy came from a swap (crypto-to-crypto or stablecoin-to-crypto)
      // A swap is detected if swappedFromAsset exists and is different from the current asset
      // If swap info is missing from the lot, try to get it from sourceTrace
      let swappedFromAsset = lot.swappedFromAsset;
      let swappedFromQuantity = lot.swappedFromQuantity;
      let swappedFromTransactionId = lot.swappedFromTransactionId;
      
      if (!swappedFromAsset) {
        const swapInfo = swapInfoByBuyTxId.get(lot.buyTransactionId);
        if (swapInfo) {
          swappedFromAsset = swapInfo.swappedFromAsset;
          swappedFromQuantity = swapInfo.swappedFromQuantity;
          swappedFromTransactionId = swapInfo.swappedFromTransactionId;
        }
      }
      
      const isSwap = swappedFromAsset && swappedFromAsset !== lot.asset;
      
      const buyKey = `buy:${lot.buyTransactionId}`;
      const buyIdx = ensure(
        buyKey,
        isSwap ? `Swap ${swappedFromAsset}→${lot.asset} #${lot.buyTransactionId}` : `Buy ${lot.asset} #${lot.buyTransactionId}`,
        [
          isSwap ? `<b>Swap ${swappedFromAsset} → ${lot.asset}</b>` : `<b>Buy ${lot.asset}</b>`,
          `Tx: ${lot.buyTransactionId}`,
          `Date: ${new Date(lot.buyDatetime).toISOString().slice(0, 10)}`,
          isSwap ? (() => {
            // Look up original transaction to get actual quantities (not scaled from sale)
            // IMPORTANT: lot.quantity is the scaled quantity from the sale (e.g., 473.984 ADA)
            // We want to show the original transaction quantity (e.g., 500 ADA)
            const originalTx = transactions?.find((t: Tx) => t.id === lot.buyTransactionId);
            if (originalTx) {
              // Use original transaction quantities
              return `Swapped ${(originalTx.fromQuantity || swappedFromQuantity || 0).toFixed(8)} ${swappedFromAsset} → ${(originalTx.toQuantity || 0).toFixed(8)} ${lot.asset}`;
            } else {
              // Fallback: use swappedFromQuantity and lot.quantity (but this will be scaled)
              return `Swapped ${(swappedFromQuantity || 0).toFixed(8)} ${swappedFromAsset} → ${lot.quantity.toFixed(8)} ${lot.asset}`;
            }
          })() : `Qty (portion): ${lot.quantity.toFixed(8)}`,
          `Basis (portion): $${lot.costBasisUsd.toFixed(2)}`,
        ].join('<br>')
      );

      addEdge(
        buyIdx,
        sellIdx,
        lot.costBasisUsd,
        `<b>${isSwap ? 'Swap' : 'Buy lot'} → Sell</b><br>Cost basis: $${lot.costBasisUsd.toFixed(2)}`,
        getAssetColor(lot.asset)
      );
      shownIncomingBasis += lot.costBasisUsd;

      // If this is a swap, show the swap chain: original buy lots -> swap -> this buy
      if (isSwap) {
        // Try to get swappedFromBuyLots from the lot, or from sourceTrace if missing
        // Prefer originalBuyLotsBySwapTxId (from sourceTrace with original values) over swappedFromBuyLots (scaled)
        // This ensures we show the correct original transaction quantities (e.g., 10 SOL @ $1000, not 5 SOL @ $500)
        let swappedFromBuyLots = originalBuyLotsBySwapTxId.get(lot.buyTransactionId);
        
        // Fall back to swappedFromBuyLots if not found in sourceTrace
        if (!swappedFromBuyLots || swappedFromBuyLots.length === 0) {
          swappedFromBuyLots = lot.swappedFromBuyLots;
        }
        
        if (swappedFromBuyLots && swappedFromBuyLots.length > 0) {
          // Show full chain: original buy lots → swap → this buy
          // Calculate scale based on the actual cost basis used (from the lot), not the original buy lot
          const swapInputTotal = swappedFromBuyLots.reduce((sum, bl) => sum + bl.costBasisUsd, 0);
          const swapScale = swapInputTotal > 0 ? (lot.costBasisUsd / swapInputTotal) : 0;
          
          // Show each original buy lot that was swapped (e.g., SOL buy lots that were swapped to ADA)
          swappedFromBuyLots.forEach((originalLot) => {
            const originalBuyKey = `buy:${originalLot.buyTransactionId}`;
            const originalBuyDate = new Date(originalLot.buyDatetime).toISOString().split('T')[0];
            const originalBuyIdx = ensure(
              originalBuyKey,
              `Buy ${originalLot.asset} #${originalLot.buyTransactionId}`,
              [
                `<b>Buy ${originalLot.asset}</b>`,
                `Tx: ${originalLot.buyTransactionId}`,
                `Date: ${originalBuyDate}`,
                `Qty: ${originalLot.quantity.toFixed(8)}`,
                `Cost basis: $${originalLot.costBasisUsd.toFixed(2)}`,
              ].join('<br>')
            );
            
            addEdge(
              originalBuyIdx,
              buyIdx,
              originalLot.costBasisUsd * swapScale,
              `<b>Buy ${originalLot.asset} → Swap</b><br>${originalLot.asset} buy funded ${swappedFromAsset}→${lot.asset} swap` +
                `<br>Original basis: $${originalLot.costBasisUsd.toFixed(2)} • Used in this sale: $${(originalLot.costBasisUsd * swapScale).toFixed(2)}`,
              getAssetColor(originalLot.asset)
            );
          });
        }
      }

      const agg = ensureBuyAgg(lot);
      agg.outflowBasisUsd += lot.costBasisUsd;
      agg.basisUsd += lot.costBasisUsd;

      const fundingSells = (lot as BuyLotTraceWithFundingSells).fundingSells ?? [];
      const fundingBasisFromSellsUsd = fundingSells.reduce((sum, x) => sum + (x.costBasisUsd || 0), 0);
      // Deposits funding this buy lot: use the explicit fundingDeposits trace (already scaled in the tax engine)
      for (const dep of lot.fundingDeposits || []) {
        const prev = agg.depositByTx.get(dep.transactionId);
        if (!prev) {
          agg.depositByTx.set(dep.transactionId, {
            transactionId: dep.transactionId,
            datetime: dep.datetime,
            asset: dep.asset,
            quantity: dep.quantity,
            costBasisUsd: dep.costBasisUsd,
          });
        } else {
          prev.quantity += dep.quantity;
          prev.costBasisUsd += dep.costBasisUsd;
          agg.depositByTx.set(dep.transactionId, prev);
        }
      }
      // If fundingDeposits is empty (should be rare), we conservatively treat remaining basis as "unknown deposits"
      if ((!lot.fundingDeposits || lot.fundingDeposits.length === 0) && (lot.costBasisUsd - fundingBasisFromSellsUsd) > 1e-9) {
        const key = -1; // sentinel "unknown"
        const prev = agg.depositByTx.get(key);
        const remaining = Math.max(0, lot.costBasisUsd - fundingBasisFromSellsUsd);
        if (!prev) {
          agg.depositByTx.set(key, {
            transactionId: -1,
            datetime: lot.buyDatetime,
            asset: 'DEPOSITS',
            quantity: 0,
            costBasisUsd: remaining,
          });
        } else {
          prev.costBasisUsd += remaining;
          agg.depositByTx.set(key, prev);
        }
      }

      for (const fs of fundingSells) {
        const prev = agg.fundingSells.get(fs.saleTransactionId);
        if (!prev) {
          agg.fundingSells.set(fs.saleTransactionId, {
            saleTransactionId: fs.saleTransactionId,
            saleDatetime: fs.saleDatetime,
            asset: fs.asset,
            amountUsd: fs.amountUsd,
            costBasisUsd: fs.costBasisUsd || 0,
          });
        } else {
          prev.amountUsd += fs.amountUsd;
          prev.costBasisUsd += fs.costBasisUsd || 0;
          agg.fundingSells.set(fs.saleTransactionId, prev);
        }
      }
    }

    // Keep sell node mass-conserving even when its buy lots aren't expanded yet.
    const missingIncoming = Math.max(0, saleBasis - shownIncomingBasis);
    if (missingIncoming > 1e-9) {
      const collapsedLotsIdx = ensure(
        `collapsedLots:${sale.saleTransactionId}`,
        '…',
        [
          `<b>Collapsed buy lots</b>`,
          `Sell Tx: ${sale.saleTransactionId}`,
          `Hidden incoming basis: $${missingIncoming.toFixed(2)}`,
          `<br><b>Tip</b>: Click this node (or the Sell) to reveal buy lots.`,
        ].join('<br>')
      );
      addEdge(
        collapsedLotsIdx,
        sellIdx,
        missingIncoming,
        `<b>Collapsed lots → Sell</b><br>Hidden incoming basis: $${missingIncoming.toFixed(2)}`,
        '#94a3b8'
      );
    }
  }

  // Inflow edges for visible buys in COST BASIS units (no normalization).
  for (const [buyId, agg] of buyAggById.entries()) {
    if (!opts.visibleBuyIds.has(buyId)) continue;
    const allFunding = Array.from(agg.fundingSells.values());
    const shownFunding = allFunding.filter((x) => visibleSales.has(x.saleTransactionId));
    const shownFundingBasisTotal = shownFunding.reduce((s, x) => s + (x.costBasisUsd || 0), 0);
    const hiddenFundingBasisTotal =
      allFunding.reduce((s, x) => s + (x.costBasisUsd || 0), 0) - shownFundingBasisTotal;

    const buyIdx = ensure(
      `buy:${buyId}`,
      `Buy ${agg.asset} #${buyId}`,
      nodeHover[nodeIndex.get(`buy:${buyId}`)!] || `<b>Buy ${agg.asset}</b><br>Tx: ${buyId}`
    );

    for (const fs of shownFunding) {
      const fsIdx = ensure(
        `sell:${fs.saleTransactionId}`,
        `Sell ${fs.asset} #${fs.saleTransactionId}`,
        [
          `<b>Sell ${fs.asset}</b>`,
          `Tx: ${fs.saleTransactionId}`,
          `Date: ${new Date(fs.saleDatetime).toISOString().slice(0, 10)}`,
        ].join('<br>')
      );
      addEdge(
        fsIdx,
        buyIdx,
        fs.costBasisUsd,
        `<b>Sell → Buy</b><br>Cost basis transferred: $${fs.costBasisUsd.toFixed(2)}`,
        getAssetColor(fs.asset)
      );
    }

    if (opts.showDepositTxs) {
      for (const dep of agg.depositByTx.values()) {
        if (!dep.costBasisUsd || dep.costBasisUsd <= 1e-9) continue;
        const depKey = dep.transactionId === -1 ? `deposit:unknown:${buyId}` : `deposit:${dep.transactionId}`;
        const depLabel = dep.transactionId === -1 ? 'Deposit (unknown)' : `Deposit ${dep.asset} #${dep.transactionId}`;
        const depHover =
          dep.transactionId === -1
            ? `<b>Deposit (unknown)</b><br>Allocated basis: $${dep.costBasisUsd.toFixed(2)}`
            : [
                `<b>Deposit ${dep.asset}</b>`,
                `Tx: ${dep.transactionId}`,
                `Date: ${new Date(dep.datetime).toISOString().slice(0, 10)}`,
                `Amount: ${dep.quantity.toFixed(2)} ${dep.asset}`,
                `Allocated basis: $${dep.costBasisUsd.toFixed(2)}`,
              ].join('<br>');
        const depIdx = ensure(depKey, depLabel, depHover);
        addEdge(
          depIdx,
          buyIdx,
          dep.costBasisUsd,
          `<b>Deposit → Buy</b><br>Cost basis: $${dep.costBasisUsd.toFixed(2)}`,
          '#64748b'
        );
      }
    }

    if (hiddenFundingBasisTotal > 1e-9) {
      const collapsedIdx = ensure(
        `collapsed:${buyId}`,
        '…',
        [
          `<b>Collapsed upstream funding</b>`,
          `Buy Tx: ${buyId}`,
          `Hidden funding sells (basis): $${hiddenFundingBasisTotal.toFixed(2)}`,
          `<br><b>Tip</b>: Click this node (or the Buy) to expand upstream sells.`,
        ].join('<br>')
      );
      addEdge(
        collapsedIdx,
        buyIdx,
        hiddenFundingBasisTotal,
        `<b>Collapsed → Buy</b><br>Hidden cost basis: $${hiddenFundingBasisTotal.toFixed(2)}`,
        '#94a3b8'
      );
    }
  }

  const sources: number[] = [];
  const targets: number[] = [];
  const values: number[] = [];
  const linkHover: string[] = [];
  const colors: string[] = [];
  for (const e of edgeMap.values()) {
    sources.push(e.from);
    targets.push(e.to);
    values.push(e.value);
    linkHover.push(`${e.hover}<br><b>Value</b>: $${e.value.toFixed(2)}`);
    colors.push(e.color);
  }

  const data: Data = {
    type: 'sankey',
    arrangement: 'fixed',
    node: {
      pad: Math.max(2, Math.min(30, opts.nodePad)),
      thickness: Math.max(6, Math.min(30, opts.nodeThickness)),
      line: { color: 'black', width: 0.35 },
      label: nodes,
      customdata: nodeHover,
      hovertemplate: '%{customdata}<extra></extra>',
      color: nodeKeys.map((k) => {
        if (k === 'withdrawal') return event.gainLossUsd >= 0 ? '#10b981' : '#ef4444';
        if (k.startsWith('deposit:')) return '#64748b';
        if (k.startsWith('collapsedLots:')) return '#94a3b8';
        if (k.startsWith('collapsed:')) return '#94a3b8';
        if (k.startsWith('buy:')) return '#a855f7';
        if (k.startsWith('sell:')) return '#3b82f6';
        return '#94a3b8';
      }),
    },
    link: {
      source: sources,
      target: targets,
      value: values,
      label: values.map(() => ''),
      customdata: linkHover,
      hovertemplate: '%{customdata}<extra></extra>',
      color: colors.map((c) => c + '66'),
    },
  } as Data;

  const layout: Partial<Layout> = {
    title: {
      text:
        `Money flow to withdrawal - ${new Date(event.datetime).toLocaleDateString()}<br>` +
        `<span style="font-size: 12px; color: ${event.gainLossUsd >= 0 ? '#10b981' : '#ef4444'}">` +
        `Net P/L: ${event.gainLossUsd >= 0 ? '+' : ''}$${event.gainLossUsd.toFixed(2)}</span>`,
      font: { size: 14 },
    },
    height: 560,
    font: { size: 10 },
  };

  return { data: [data], layout, nodeKeys };
}

function SankeyExplorer({ event, transactions, onTransactionClick }: { event: TaxableEvent; transactions?: Tx[]; onTransactionClick?: (txId: number) => void }) {
  const directSales = event.saleTrace || [];
  const rootSaleIds = useMemo(() => directSales.map((s) => s.saleTransactionId), [directSales]);
  // Start compact: show only Withdrawal + direct funding sells. Buy lots appear when you click a sell.
  const rootBuyIds = useMemo(() => [] as number[], []);

  const [visibleSaleIds, setVisibleSaleIds] = useState<number[]>(rootSaleIds);
  const [visibleBuyIds, setVisibleBuyIds] = useState<number[]>(rootBuyIds);
  // Separate state for transaction tree expansion (starts collapsed)
  const [withdrawalExpanded, setWithdrawalExpanded] = useState<boolean>(false);
  const [treeVisibleSaleIds, setTreeVisibleSaleIds] = useState<number[]>([]);
  const [treeVisibleBuyIds, setTreeVisibleBuyIds] = useState<number[]>([]);
  const [showDepositTxs, setShowDepositTxs] = useState<boolean>(false);
  const [showLabels, setShowLabels] = useState<boolean>(false);
  const [nodeThickness, setNodeThickness] = useState<number>(10);
  const [nodePad, setNodePad] = useState<number>(10);

  const deepSales = (event.saleTraceDeep && event.saleTraceDeep.length ? event.saleTraceDeep : directSales) || [];
  const deepSaleById = useMemo(() => {
    const m = new Map<number, (typeof deepSales)[number]>();
    for (const s of deepSales) m.set(s.saleTransactionId, s);
    return m;
  }, [deepSales]);
  const buyFundingSellIds = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (const s of deepSales) {
      for (const bl of s.buyLots) {
        const fs = (bl as BuyLotTraceWithFundingSells).fundingSells || [];
        if (!fs.length) continue;
        const set = map.get(bl.buyTransactionId) || new Set<number>();
        for (const f of fs) set.add(f.saleTransactionId);
        map.set(bl.buyTransactionId, set);
      }
    }
    return map;
  }, [deepSales]);

  const data = useMemo(() => {
    return createSankeyExplorerData(event, {
      visibleSaleIds: new Set<number>(visibleSaleIds),
      visibleBuyIds: new Set<number>(visibleBuyIds),
      showDepositTxs,
      showLabels,
      nodeThickness,
      nodePad,
    }, transactions);
  }, [event, visibleSaleIds, visibleBuyIds, showDepositTxs, showLabels, nodeThickness, nodePad, transactions]);

  const onNodeClick = useCallback((ev: unknown) => {
    const e = ev as { points?: Array<{ pointNumber?: number; pointIndex?: number }> } | null;
    const p = e?.points?.[0];
    const idx = typeof p?.pointNumber === 'number'
      ? p.pointNumber
      : (typeof p?.pointIndex === 'number' ? p.pointIndex : null);
    if (idx === null) return;
    const key = data.nodeKeys[idx];
    if (!key) return;

    if (key.startsWith('collapsed:')) {
      const buyId = Number(key.slice('collapsed:'.length));
      if (!Number.isFinite(buyId)) return;
      const fs = buyFundingSellIds.get(buyId);
      if (!fs || !fs.size) return;
      const newSales = new Set<number>(visibleSaleIds);
      for (const id of fs.values()) newSales.add(id);
      setVisibleSaleIds(Array.from(newSales.values()));
      // Also ensure this buy is visible (if clicked from some other view)
      const newBuys = new Set<number>(visibleBuyIds);
      newBuys.add(buyId);
      setVisibleBuyIds(Array.from(newBuys.values()));
      return;
    }

    if (key.startsWith('collapsedLots:')) {
      const saleId = Number(key.slice('collapsedLots:'.length));
      if (!Number.isFinite(saleId)) return;
      const sale = deepSaleById.get(saleId);
      if (!sale) return;
      const newBuys = new Set<number>(visibleBuyIds);
      for (const bl of sale.buyLots) newBuys.add(bl.buyTransactionId);
      setVisibleBuyIds(Array.from(newBuys.values()));
      return;
    }

    if (key.startsWith('sell:')) {
      const saleId = Number(key.slice('sell:'.length));
      const sale = deepSaleById.get(saleId);
      if (!sale) return;
      const newBuys = new Set<number>(visibleBuyIds);
      for (const bl of sale.buyLots) newBuys.add(bl.buyTransactionId);
      setVisibleBuyIds(Array.from(newBuys.values()));
      return;
    }

    if (key.startsWith('buy:')) {
      const buyId = Number(key.slice('buy:'.length));
      const fs = buyFundingSellIds.get(buyId);
      if (!fs || !fs.size) return;
      const newSales = new Set<number>(visibleSaleIds);
      for (const id of fs.values()) newSales.add(id);
      setVisibleSaleIds(Array.from(newSales.values()));
      return;
    }
  }, [data.nodeKeys, deepSaleById, buyFundingSellIds, visibleBuyIds, visibleSaleIds]);

  const onReset = useCallback(() => {
    setVisibleSaleIds(rootSaleIds);
    setVisibleBuyIds(rootBuyIds);
  }, [rootSaleIds, rootBuyIds]);

  const onExpandAll = useCallback(() => {
    // Only expand the Sankey diagram, NOT the transaction tree
    const allSales = new Set<number>(visibleSaleIds);
    const allBuys = new Set<number>(visibleBuyIds);
    for (const s of deepSales) {
      allSales.add(s.saleTransactionId);
      for (const bl of s.buyLots) allBuys.add(bl.buyTransactionId);
    }
    setVisibleSaleIds(Array.from(allSales.values()));
    setVisibleBuyIds(Array.from(allBuys.values()));
    // Keep deposit transaction nodes OFF by default when expanding everything (too noisy).
    setShowDepositTxs(false);
    // Do NOT expand the transaction tree - it should remain collapsed for manual navigation
  }, [deepSales, visibleSaleIds, visibleBuyIds]);

  // Build hierarchical transaction tree for better exploration
  const transactionTree = useMemo(() => {
    const tree: Array<{
      id: string;
      type: 'withdrawal' | 'sell' | 'buy' | 'deposit';
      transactionId?: number;
      asset: string;
      amount: number;
      quantity?: number; // Quantity of asset
      costBasis?: number;
      datetime: string;
      children: Array<typeof tree[number]>;
      expanded: boolean;
      hasChildren?: boolean;
    }> = [];

    // Add withdrawal as root
    const withdrawalTx = transactions?.find(t => t.id === event.transactionId);
    if (withdrawalTx) {
      const withdrawalAmount = event.fiatAmountUsd || (withdrawalTx.toQuantity || 0);
      const hasChildren = deepSales.length > 0;
      tree.push({
        id: `withdrawal-${withdrawalTx.id}`,
        type: 'withdrawal',
        transactionId: withdrawalTx.id,
        asset: withdrawalTx.toAsset.toUpperCase(),
        amount: withdrawalAmount,
        quantity: withdrawalTx.toQuantity || 0,
        datetime: withdrawalTx.datetime,
        children: [],
        expanded: withdrawalExpanded, // Use state for expansion
        hasChildren: hasChildren,
      });
    }

    // Use deepSales to show the full hierarchy (matches what's in the Sankey diagram)
    for (const sale of deepSales) {
      const saleTx = transactions?.find(t => t.id === sale.saleTransactionId);
      if (saleTx) {
        // Always check if there are buy lots (to show expand button even when collapsed)
        const hasBuyLots = sale.buyLots && sale.buyLots.length > 0;
        
        // Calculate quantity sold from transaction or estimate from proceeds
        let saleQuantity = 0;
        if (saleTx.fromAsset && saleTx.fromAsset.toUpperCase() === sale.asset.toUpperCase()) {
          saleQuantity = saleTx.fromQuantity || 0;
        } else if (saleTx.toAsset && saleTx.toAsset.toUpperCase() === sale.asset.toUpperCase()) {
          saleQuantity = saleTx.toQuantity || 0;
        } else {
          // Estimate from proceeds if we have a price
          const price = saleTx.fromPriceUsd || saleTx.toPriceUsd || 0;
          if (price > 0 && sale.proceedsUsd > 0) {
            saleQuantity = sale.proceedsUsd / price;
          }
        }
        
        const saleNode: typeof tree[number] = {
          id: `sell-${sale.saleTransactionId}`,
          type: 'sell' as const,
          transactionId: sale.saleTransactionId,
          asset: sale.asset.toUpperCase(), // Use sale.asset (what's being sold) not saleTx.toAsset (what's received)
          amount: sale.proceedsUsd || 0,
          quantity: saleQuantity,
          costBasis: sale.costBasisUsd || 0,
          datetime: saleTx.datetime,
          children: [],
          expanded: treeVisibleSaleIds.includes(sale.saleTransactionId), // Use tree-specific state
          hasChildren: hasBuyLots, // Track if there are children available
        };
        
        // Add buy lots for this sale
        if (treeVisibleSaleIds.includes(sale.saleTransactionId) && hasBuyLots) {
          for (const buyLot of sale.buyLots) {
            const buyTx = transactions?.find(t => t.id === buyLot.buyTransactionId);
            if (buyTx) {
              const fundingSells = (buyLot as BuyLotTraceWithFundingSells).fundingSells || [];
              const hasFundingSells = fundingSells.length > 0;
              
              const buyNode = {
                id: `buy-${buyLot.buyTransactionId}`,
                type: 'buy' as const,
                transactionId: buyLot.buyTransactionId,
                asset: buyLot.asset.toUpperCase(),
                amount: (buyLot.cashSpentUsd || buyLot.costBasisUsd || 0),
                quantity: buyLot.quantity || 0,
                costBasis: buyLot.costBasisUsd || 0,
                datetime: buyLot.buyDatetime,
                children: [] as typeof tree[number][],
                expanded: treeVisibleBuyIds.includes(buyLot.buyTransactionId), // Use tree-specific state
                hasChildren: hasFundingSells, // Track if there are children available
              };

              // Add funding sells for this buy
              if (treeVisibleBuyIds.includes(buyLot.buyTransactionId) && hasFundingSells) {
                for (const fundingSell of fundingSells) {
                  const fundingTx = transactions?.find(t => t.id === fundingSell.saleTransactionId);
                  // Estimate quantity from amount and price if available
                  let fundingQuantity = 0;
                  if (fundingTx) {
                    if (fundingTx.fromAsset && fundingTx.fromAsset.toUpperCase() === fundingSell.asset.toUpperCase()) {
                      fundingQuantity = fundingTx.fromQuantity || 0;
                    } else if (fundingTx.toAsset && fundingTx.toAsset.toUpperCase() === fundingSell.asset.toUpperCase()) {
                      fundingQuantity = fundingTx.toQuantity || 0;
                    } else {
                      const price = fundingTx.fromPriceUsd || fundingTx.toPriceUsd || 0;
                      if (price > 0 && fundingSell.amountUsd > 0) {
                        fundingQuantity = fundingSell.amountUsd / price;
                      }
                    }
                  }
                  buyNode.children.push({
                    id: `funding-sell-${fundingSell.saleTransactionId}`,
                    type: 'sell',
                    transactionId: fundingSell.saleTransactionId,
                    asset: fundingSell.asset.toUpperCase(),
                    amount: fundingSell.amountUsd || 0,
                    quantity: fundingQuantity,
                    costBasis: fundingSell.costBasisUsd || 0,
                    datetime: fundingSell.saleDatetime,
                    children: [],
                    expanded: false,
                    hasChildren: false,
                  });
                }
                // Sort funding sells by cost contribution (highest to lowest)
                buyNode.children.sort((a, b) => (b.costBasis || b.amount || 0) - (a.costBasis || a.amount || 0));
              }

              saleNode.children.push(buyNode);
            }
          }
          // Sort buy lots by cost contribution (highest to lowest)
          if (saleNode.children.length > 0) {
            saleNode.children.sort((a, b) => (b.costBasis || b.amount || 0) - (a.costBasis || a.amount || 0));
          }
        }
        // hasChildren is already set above when creating saleNode

        // Only add sale nodes as children if withdrawal is expanded
        if (tree[0] && withdrawalExpanded) {
          tree[0].children.push(saleNode);
        }
      }
    }
    
    // Sort sale nodes by cost contribution (highest to lowest) for the withdrawal
    if (tree[0] && tree[0].children.length > 0) {
      tree[0].children.sort((a, b) => (b.costBasis || b.amount || 0) - (a.costBasis || a.amount || 0));
    }

    return tree;
  }, [event, transactions, deepSales, treeVisibleSaleIds, treeVisibleBuyIds, withdrawalExpanded]);

  const toggleNode = useCallback((nodeId: string) => {
    // Toggle transaction tree expansion (separate from Sankey diagram)
    if (nodeId.startsWith('withdrawal-')) {
      setWithdrawalExpanded(!withdrawalExpanded);
    } else if (nodeId.startsWith('sell-')) {
      const saleId = Number(nodeId.slice('sell-'.length));
      if (treeVisibleSaleIds.includes(saleId)) {
        setTreeVisibleSaleIds(treeVisibleSaleIds.filter(id => id !== saleId));
      } else {
        setTreeVisibleSaleIds([...treeVisibleSaleIds, saleId]);
      }
    } else if (nodeId.startsWith('buy-')) {
      const buyId = Number(nodeId.slice('buy-'.length));
      if (treeVisibleBuyIds.includes(buyId)) {
        setTreeVisibleBuyIds(treeVisibleBuyIds.filter(id => id !== buyId));
      } else {
        setTreeVisibleBuyIds([...treeVisibleBuyIds, buyId]);
      }
    }
  }, [treeVisibleSaleIds, treeVisibleBuyIds, withdrawalExpanded]);

  const [selectedTransactionId, setSelectedTransactionId] = useState<number | null>(null);

  const renderTransactionDetails = useCallback((tx: Tx | undefined) => {
    if (!tx) return null;

    const nf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    const df = new Intl.DateTimeFormat('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    return (
      <div style={{ 
        padding: '16px', 
        backgroundColor: 'var(--card)', 
        borderRadius: '8px', 
        border: '1px solid var(--border)',
        marginTop: '12px'
      }}>
        <h5 style={{ margin: '0 0 12px 0', fontSize: '1rem', fontWeight: 600 }}>Transaction Details</h5>
        <div style={{ display: 'grid', gap: '12px', fontSize: '0.9rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>Date:</span>
            <span>{df.format(new Date(tx.datetime))}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--muted)' }}>Type:</span>
            <span className={`transaction-type-badge ${tx.type.toLowerCase()}`}>
              {tx.type === 'Deposit' ? '💰' : tx.type === 'Withdrawal' ? '💸' : '🔄'} {tx.type}
            </span>
          </div>
          {tx.fromAsset && (
            <div style={{ 
              padding: '12px', 
              backgroundColor: 'var(--surface)', 
              borderRadius: '6px',
              border: '1px solid var(--border)'
            }}>
              <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '8px' }}>From:</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <CryptoIcon symbol={tx.fromAsset} size={20} alt={`${tx.fromAsset} logo`} />
                <span style={{ 
                  display: 'inline-block', 
                  padding: '4px 10px', 
                  borderRadius: 12, 
                  background: `${getAssetColor(tx.fromAsset)}22`, 
                  color: getAssetColor(tx.fromAsset), 
                  fontWeight: 600 
                }}>
                  {tx.fromAsset.toUpperCase()}
                </span>
              </div>
              {tx.fromQuantity && (
                <div style={{ fontSize: '0.9em', color: 'var(--muted)', marginTop: '4px' }}>
                  {nf.format(tx.fromQuantity)} {tx.fromPriceUsd ? `@ $${nf.format(tx.fromPriceUsd)}` : ''}
                </div>
              )}
            </div>
          )}
          <div style={{ 
            padding: '12px', 
            backgroundColor: 'var(--surface)', 
            borderRadius: '6px',
            border: '1px solid var(--border)'
          }}>
            <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '8px' }}>To:</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <CryptoIcon symbol={tx.toAsset} size={20} alt={`${tx.toAsset} logo`} />
              <span style={{ 
                display: 'inline-block', 
                padding: '4px 10px', 
                borderRadius: 12, 
                background: `${getAssetColor(tx.toAsset)}22`, 
                color: getAssetColor(tx.toAsset), 
                fontWeight: 600 
              }}>
                {tx.toAsset.toUpperCase()}
              </span>
            </div>
            <div style={{ fontSize: '0.9em', color: 'var(--muted)', marginTop: '4px' }}>
              {nf.format(tx.toQuantity)} {tx.toPriceUsd ? `@ $${nf.format(tx.toPriceUsd)}` : ''}
            </div>
          </div>
          {tx.feesUsd && tx.feesUsd > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--muted)' }}>Fees:</span>
              <span>${nf.format(tx.feesUsd)}</span>
            </div>
          )}
          {tx.notes && (
            <div>
              <div style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '4px' }}>Notes:</div>
              <div style={{ color: 'var(--text)', fontSize: '0.9rem' }}>{tx.notes}</div>
            </div>
          )}
        </div>
      </div>
    );
  }, []);

  const renderTreeNode = useCallback((node: typeof transactionTree[number] & { hasChildren?: boolean }, level: number = 0) => {
    const indent = level * 24;
    const isExpanded = node.expanded;
    // Check both current children and the hasChildren flag (for nodes that have children but they're not loaded yet)
    const hasChildren = node.children.length > 0 || node.hasChildren === true;
    const tx = node.transactionId ? transactions?.find(t => t.id === node.transactionId) : undefined;
    const showDetails = selectedTransactionId === node.transactionId;
    
    const typeColors = {
      withdrawal: '#ef4444',
      sell: '#f59e0b',
      buy: '#10b981',
      deposit: '#3b82f6',
    };

    const typeIcons = {
      withdrawal: '💸',
      sell: '📤',
      buy: '📥',
      deposit: '💰',
    };

    return (
      <div key={node.id}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px 12px',
            marginLeft: `${indent}px`,
            backgroundColor: level % 2 === 0 ? 'var(--surface)' : 'var(--card)',
            borderLeft: `3px solid ${typeColors[node.type]}`,
            borderRadius: '6px',
            marginBottom: '4px',
            cursor: hasChildren ? 'pointer' : 'default',
            transition: 'all 0.2s',
          }}
          onClick={(e) => {
            if (hasChildren) {
              e.stopPropagation();
              toggleNode(node.id);
            }
          }}
          onMouseEnter={(e) => {
            if (hasChildren) {
              e.currentTarget.style.backgroundColor = 'rgba(125, 125, 125, 0.1)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = level % 2 === 0 ? 'var(--surface)' : 'var(--card)';
          }}
        >
          {hasChildren && (
            <span 
              style={{ fontSize: '0.8rem', minWidth: '16px', cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                toggleNode(node.id);
              }}
            >
              {isExpanded ? '▼' : '▶'}
            </span>
          )}
          {!hasChildren && <span style={{ minWidth: '16px' }} />}
          <span style={{ fontSize: '1.1rem' }}>{typeIcons[node.type]}</span>
          <span style={{ fontWeight: 600, color: typeColors[node.type] }}>
            {node.type.toUpperCase()}
          </span>
          <span style={{ color: getAssetColor(node.asset), fontWeight: 600 }}>
            {node.asset}
          </span>
          {node.quantity !== undefined && node.quantity > 0 && (
            <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem', fontSize: '0.85rem' }}>
              {node.quantity.toFixed(4)} units
            </span>
          )}
          <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: '0.9rem' }}>
            ${node.amount.toFixed(2)}
          </span>
          {node.costBasis !== undefined && node.costBasis > 0 && (
            <>
              {node.quantity !== undefined && node.quantity > 0 && (
                <span style={{ color: 'var(--muted)', fontSize: '0.8rem', minWidth: '90px', textAlign: 'right' }}>
                  ${(node.costBasis / node.quantity).toFixed(2)}/unit
                </span>
              )}
              <span style={{ color: 'var(--muted)', fontSize: '0.85rem', minWidth: '90px', textAlign: 'right' }}>
                Cost: ${node.costBasis.toFixed(2)}
              </span>
            </>
          )}
          <span style={{ color: 'var(--muted)', fontSize: '0.8rem', minWidth: '100px', textAlign: 'right' }}>
            {new Date(node.datetime).toLocaleDateString()}
          </span>
          {node.transactionId && (
            <button
              className="btn btn-secondary btn-sm"
              style={{ 
                padding: '4px 8px', 
                fontSize: '0.75rem',
                marginLeft: '8px'
              }}
              onClick={(e) => {
                e.stopPropagation();
                setSelectedTransactionId(showDetails ? null : node.transactionId || null);
              }}
              title="View transaction details"
            >
              {showDetails ? '▼' : '▶'} Details
            </button>
          )}
        </div>
        {showDetails && tx && (
          <div style={{ marginLeft: `${indent + 24}px`, marginBottom: '8px' }}>
            {renderTransactionDetails(tx)}
          </div>
        )}
        {isExpanded && hasChildren && (
          <div style={{ marginLeft: `${indent + 24}px` }}>
            {node.children.map(child => renderTreeNode(child, level + 1))}
          </div>
        )}
      </div>
    );
  }, [toggleNode, transactions, selectedTransactionId, renderTransactionDetails]);

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem', padding: '12px', backgroundColor: 'var(--card)', borderRadius: '8px', border: '1px solid var(--border)' }}>
        <button 
          onClick={onReset} 
          className="btn btn-secondary btn-sm"
        >
          🔄 Reset
        </button>
        <button 
          onClick={onExpandAll} 
          className="btn btn-secondary btn-sm"
        >
          ⬇️ Expand All
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={showDepositTxs} onChange={(e) => setShowDepositTxs(e.target.checked)} />
            Show deposits
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--muted)', fontSize: '0.85rem' }}>
            <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
            Show labels
          </label>
        </div>
      </div>

      {/* Sankey Diagram */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>
          Flow Diagram
        </h4>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem', fontSize: '0.85rem', color: 'var(--muted)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Node thickness
            <input
              type="range"
              min={6}
              max={22}
              value={nodeThickness}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNodeThickness(Number(e.target.value))}
              style={{ width: '100px' }}
            />
            <span style={{ minWidth: 24, textAlign: 'right' }}>{nodeThickness}</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            Node padding
            <input
              type="range"
              min={4}
              max={22}
              value={nodePad}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNodePad(Number(e.target.value))}
              style={{ width: '100px' }}
            />
            <span style={{ minWidth: 24, textAlign: 'right' }}>{nodePad}</span>
          </label>
          <span style={{ color: 'var(--muted)', fontSize: '0.85rem' }}>
            Click nodes in the diagram to explore transactions hierarchically.
          </span>
        </div>
        <Plot
          data={data.data}
          layout={data.layout}
          style={{ width: '100%', minHeight: '400px' }}
          onClick={onNodeClick}
        />
      </div>

      {/* Hierarchical Tree View */}
      <div style={{ 
        marginTop: '1.5rem',
        padding: '16px',
        backgroundColor: 'var(--card)',
        borderRadius: '8px',
        border: '1px solid var(--border)',
        maxHeight: '600px',
        overflowY: 'auto'
      }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: 600, color: 'var(--text)' }}>
          Transaction Hierarchy
        </h4>
        <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: '12px' }}>
          Click on transactions with children (▶) to expand and explore the flow. Click &quot;Details&quot; to view full transaction information. Colors: 💸 Withdrawal (red), 📤 Sell (orange), 📥 Buy (green), 💰 Deposit (blue)
        </div>
        {transactionTree.map(node => renderTreeNode(node))}
      </div>
    </div>
  );
}

export default function CashDashboardPage(){
  const { selectedId } = usePortfolio();
  const listKey = selectedId === 'all' ? '/api/transactions' : (selectedId? `/api/transactions?portfolioId=${selectedId}` : null);
  const { data: txs, isLoading: loadingTxs } = useSWR<Tx[]>(listKey, fetcher);
  const [selectedCurrency, setSelectedCurrency] = useState<string>('USD');
  const [selectedTaxYear, setSelectedTaxYear] = useState<string>('all'); // 'all' | '2024' | '2023' | etc.
  const [selectedAssetLotStrategy, setSelectedAssetLotStrategy] = useState<'FIFO' | 'LIFO' | 'HIFO' | 'LOFO'>('FIFO');
  const [selectedCashLotStrategy, setSelectedCashLotStrategy] = useState<'FIFO' | 'LIFO' | 'HIFO' | 'LOFO'>('FIFO');
  const [expandedEventId, setExpandedEventId] = useState<number | null>(null);
  const exportGuardsRef = useRef<Set<string>>(new Set());
  
  // Fetch Romania tax report for selected year
  const taxReportKey = selectedTaxYear !== 'all' 
    ? `/api/tax/romania?year=${selectedTaxYear}&assetStrategy=${selectedAssetLotStrategy}&cashStrategy=${selectedCashLotStrategy}${selectedId && selectedId !== 'all' ? `&portfolioId=${selectedId}` : ''}`
    : null;
  const { data: taxReport, isLoading: loadingTax, error: taxError } = useSWR<RomaniaTaxReport>(taxReportKey, fetcher);

  // Filter for fiat currency transactions only
  const fiatTxs = useMemo(() => {
    const fiatCurrencies = getFiatCurrencies();
    return (txs || []).filter(tx => {
      const isCashTransaction = (tx.type === 'Deposit' || tx.type === 'Withdrawal');
      if (!isCashTransaction) return false;
      
      // For deposits: fiat is in fromAsset; for withdrawals: fiat is in toAsset
      const fiatAsset = tx.type === 'Deposit' && tx.fromAsset
        ? tx.fromAsset.toUpperCase()
        : tx.toAsset.toUpperCase();
      const isFiat = fiatCurrencies.includes(fiatAsset);
      
      if (!isFiat) return false;
      
      // Apply tax year filter
      if (selectedTaxYear !== 'all') {
        const txYear = new Date(tx.datetime).getFullYear().toString();
        return txYear === selectedTaxYear;
      }
      
      return true;
    });
  }, [txs, selectedTaxYear]);

  const fiatCurrencies = getFiatCurrencies();

  // Get available tax years from all fiat transactions
  const availableTaxYears = useMemo(() => {
    const fiatCurrencies = getFiatCurrencies();
    const allFiatTxs = (txs || []).filter(tx => {
      const isCashTransaction = (tx.type === 'Deposit' || tx.type === 'Withdrawal');
      if (!isCashTransaction) return false;
      
      // For deposits: fiat is in fromAsset; for withdrawals: fiat is in toAsset
      const fiatAsset = tx.type === 'Deposit' && tx.fromAsset
        ? tx.fromAsset.toUpperCase()
        : tx.toAsset.toUpperCase();
      return fiatCurrencies.includes(fiatAsset);
    });
    
    const years = new Set<string>();
    allFiatTxs.forEach(tx => {
      const year = new Date(tx.datetime).getFullYear().toString();
      years.add(year);
    });
    
    return ['all', ...Array.from(years).sort((a, b) => b.localeCompare(a))];
  }, [txs]);

  // Default Tax Year: last full calendar year (e.g. in Feb 2026 default to 2025).
  // If you don't have fiat transactions in that year, pick the most recent available year <= last full year.
  useEffect(() => {
    if (selectedTaxYear !== 'all') return;
    const yearsOnly = availableTaxYears.filter((y) => y !== 'all');
    if (!yearsOnly.length) return;

    const lastFullYear = new Date().getFullYear() - 1;
    const best = yearsOnly
      .map((y) => parseInt(y, 10))
      .filter((y) => Number.isFinite(y) && y <= lastFullYear)
      .sort((a, b) => b - a)[0];

    if (best !== undefined) setSelectedTaxYear(String(best));
  }, [availableTaxYears, selectedTaxYear]);

  const triggerDownloadOnce = useCallback((key: string, url: string) => {
    // Prevent accidental double downloads (double-click, touch events, slow browser, etc.)
    if (exportGuardsRef.current.has(key)) return;
    exportGuardsRef.current.add(key);
    setTimeout(() => exportGuardsRef.current.delete(key), 1500);

    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, []);

  // Calculate cash flow data
  const cashFlowData = useMemo(() => {
    const data: { [key: string]: { deposits: number; withdrawals: number; balance: number; dates: string[] } } = {};
    
    fiatCurrencies.forEach(currency => {
      data[currency] = {
        deposits: 0,
        withdrawals: 0,
        balance: 0,
        dates: []
      };
    });

    // Sort transactions by date
    const sortedTxs = [...fiatTxs].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
    
    sortedTxs.forEach(tx => {
      // For deposits: fiat currency and amount are in fromAsset/fromQuantity
      // For withdrawals: fiat currency and amount are in toAsset/toQuantity
      const currency = tx.type === 'Deposit' && tx.fromAsset
        ? tx.fromAsset.toUpperCase()
        : tx.toAsset.toUpperCase();
      const amount = tx.type === 'Deposit'
        ? (tx.fromQuantity || 0)
        : (tx.toQuantity || 0);
      const date = new Date(tx.datetime).toISOString().split('T')[0];
      
      if (!data[currency]) {
        data[currency] = {
          deposits: 0,
          withdrawals: 0,
          balance: 0,
          dates: []
        };
      }
      
      if (tx.type === 'Deposit') {
        data[currency].deposits += amount;
        data[currency].balance += amount;
      } else if (tx.type === 'Withdrawal') {
        data[currency].withdrawals += amount;
        data[currency].balance -= amount;
      }
      
      if (!data[currency].dates.includes(date)) {
        data[currency].dates.push(date);
      }
    });

    return data;
  }, [fiatTxs, fiatCurrencies]);

  // Calculate running balance over time (all fiat currencies converted to USD)
  const balanceOverTime = useMemo(() => {
    // If filtering by year, calculate starting balance from all transactions before that year
    const startingBalancesByCurrency: Record<string, number> = {};
    if (selectedTaxYear !== 'all') {
      const allFiatTxs = (txs || []).filter(tx => {
        const isCashTransaction = (tx.type === 'Deposit' || tx.type === 'Withdrawal');
        if (!isCashTransaction) return false;
        
        const fiatAsset = tx.type === 'Deposit' && tx.fromAsset
          ? tx.fromAsset.toUpperCase()
          : tx.toAsset.toUpperCase();
        const isFiat = fiatCurrencies.includes(fiatAsset);
        if (!isFiat) return false;
        
        // Only include transactions before the selected year
        const txYear = new Date(tx.datetime).getFullYear().toString();
        return txYear < selectedTaxYear;
      });
      
      // Initialize starting balances
      fiatCurrencies.forEach(currency => {
        startingBalancesByCurrency[currency] = 0;
      });
      
      // Calculate starting balance from all transactions before the selected year
      allFiatTxs.forEach(tx => {
        const currency = tx.type === 'Deposit' && tx.fromAsset
          ? tx.fromAsset.toUpperCase()
          : tx.toAsset.toUpperCase();
        const amount = tx.type === 'Deposit'
          ? (tx.fromQuantity || 0)
          : (tx.toQuantity || 0);
        
        if (tx.type === 'Deposit') {
          startingBalancesByCurrency[currency] = (startingBalancesByCurrency[currency] || 0) + amount;
        } else if (tx.type === 'Withdrawal') {
          startingBalancesByCurrency[currency] = (startingBalancesByCurrency[currency] || 0) - amount;
        }
      });
    }
    
    const sortedTxs = [...fiatTxs].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
    
    const dates: string[] = [];
    const balances: number[] = [];
    const balancesByCurrency: Record<string, number> = { ...startingBalancesByCurrency };
    
    // Initialize balances for all fiat currencies (if not already set from starting balances)
    fiatCurrencies.forEach(currency => {
      if (balancesByCurrency[currency] === undefined) {
        balancesByCurrency[currency] = 0;
      }
    });
    
    // Add starting balance point if filtering by year
    if (selectedTaxYear !== 'all' && sortedTxs.length > 0) {
      const firstTxDate = new Date(sortedTxs[0].datetime);
      const yearStart = new Date(parseInt(selectedTaxYear), 0, 1);
      if (firstTxDate > yearStart) {
        // Add a point at the start of the year with the starting balance
        let startingBalanceUsd = 0;
        for (const [curr, balance] of Object.entries(balancesByCurrency)) {
          if (balance !== 0) {
            startingBalanceUsd += convertFiat(balance, curr, 'USD');
          }
        }
        dates.push(yearStart.toISOString().split('T')[0]);
        balances.push(startingBalanceUsd);
      }
    }
    
    sortedTxs.forEach(tx => {
      const date = new Date(tx.datetime).toISOString().split('T')[0];
      // For deposits: fiat currency and amount are in fromAsset/fromQuantity
      // For withdrawals: fiat currency and amount are in toAsset/toQuantity
      const currency = tx.type === 'Deposit' && tx.fromAsset
        ? tx.fromAsset.toUpperCase()
        : tx.toAsset.toUpperCase();
      const amount = tx.type === 'Deposit'
        ? (tx.fromQuantity || 0)
        : (tx.toQuantity || 0);
      
      if (tx.type === 'Deposit') {
        balancesByCurrency[currency] = (balancesByCurrency[currency] || 0) + amount;
      } else if (tx.type === 'Withdrawal') {
        balancesByCurrency[currency] = (balancesByCurrency[currency] || 0) - amount;
      }
      
      // Calculate total balance in USD
      let totalBalanceUsd = 0;
      for (const [curr, balance] of Object.entries(balancesByCurrency)) {
        if (balance !== 0) {
          totalBalanceUsd += convertFiat(balance, curr, 'USD');
        }
      }
      
      dates.push(date);
      balances.push(totalBalanceUsd);
    });
    
    return { dates, balances };
  }, [fiatTxs, fiatCurrencies, selectedTaxYear, txs]);

  // Calculate monthly cash flow
  const monthlyCashFlow = useMemo(() => {
    const currency = selectedCurrency;
    const currencyTxs = fiatTxs.filter(tx => {
      // For deposits: fiat currency is in fromAsset; for withdrawals: fiat currency is in toAsset
      const fiatAsset = tx.type === 'Deposit' && tx.fromAsset
        ? tx.fromAsset.toUpperCase()
        : tx.toAsset.toUpperCase();
      return fiatAsset === currency;
    });
    
    const monthlyData: { [key: string]: { deposits: number; withdrawals: number } } = {};
    
    currencyTxs.forEach(tx => {
      const date = new Date(tx.datetime);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { deposits: 0, withdrawals: 0 };
      }
      
      // For deposits: amount is in fromQuantity; for withdrawals: amount is in toQuantity
      const amount = tx.type === 'Deposit'
        ? (tx.fromQuantity || 0)
        : (tx.toQuantity || 0);
      
      if (tx.type === 'Deposit') {
        monthlyData[monthKey].deposits += amount;
      } else if (tx.type === 'Withdrawal') {
        monthlyData[monthKey].withdrawals += amount;
      }
    });
    
    const months = Object.keys(monthlyData).sort();
    const deposits = months.map(month => monthlyData[month].deposits);
    const withdrawals = months.map(month => monthlyData[month].withdrawals);
    
    return { months, deposits, withdrawals };
  }, [fiatTxs, selectedCurrency]);

  // Calculate total balances in USD equivalent
  const totalBalances = useMemo(() => {
    const totals: { [key: string]: number } = {};
    
    fiatCurrencies.forEach(currency => {
      const currencyTxs = fiatTxs.filter(tx => {
        // For deposits: fiat currency is in fromAsset; for withdrawals: fiat currency is in toAsset
        const fiatAsset = tx.type === 'Deposit' && tx.fromAsset
          ? tx.fromAsset.toUpperCase()
          : tx.toAsset.toUpperCase();
        return fiatAsset === currency;
      });
      let balance = 0;
      
      currencyTxs.forEach(tx => {
        // For deposits: amount is in fromQuantity; for withdrawals: amount is in toQuantity
        const amount = tx.type === 'Deposit'
          ? (tx.fromQuantity || 0)
          : (tx.toQuantity || 0);
        
        if (tx.type === 'Deposit') {
          balance += amount;
        } else if (tx.type === 'Withdrawal') {
          balance -= amount;
        }
      });
      
      // Convert to USD for comparison
      const usdBalance = convertFiat(balance, currency, 'USD');
      totals[currency] = usdBalance;
    });
    
    return totals;
  }, [fiatTxs, fiatCurrencies]);

  const colorFor = useCallback((asset: string): string => {
    return getAssetColor(asset);
  }, []);

  // Cash Flow Chart (Deposits vs Withdrawals)
  const cashFlowChart: Data[] = [
    {
      x: fiatCurrencies,
      y: fiatCurrencies.map(currency => cashFlowData[currency].deposits),
      type: 'bar',
      name: 'Deposits',
      marker: { color: '#10b981' },
    },
    {
      x: fiatCurrencies,
      y: fiatCurrencies.map(currency => cashFlowData[currency].withdrawals),
      type: 'bar',
      name: 'Withdrawals',
      marker: { color: '#ef4444' },
    },
  ];

  const cashFlowLayout: Partial<Layout> = {
    title: { text: `Cash Flow by Currency${selectedTaxYear !== 'all' ? ` (${selectedTaxYear})` : ''}` },
    xaxis: { title: { text: 'Currency' } },
    yaxis: { title: { text: 'Amount' } },
    barmode: 'group',
    height: 400,
  };

  // Balance Over Time Chart
  const balanceOverTimeChart: Data[] = [
    {
      x: balanceOverTime.dates,
      y: balanceOverTime.balances,
      type: 'scatter',
      mode: 'lines+markers',
      name: 'Total Cash Balance (USD)',
      line: { color: '#3b82f6' },
      marker: { size: 6 },
    },
  ];

  const balanceOverTimeLayout: Partial<Layout> = {
    title: { text: `Total Cash Balance Over Time (USD)${selectedTaxYear !== 'all' ? ` (${selectedTaxYear})` : ''}` },
    xaxis: { title: { text: 'Date' } },
    yaxis: { title: { text: 'Balance (USD)' } },
    height: 400,
  };

  // Monthly Cash Flow Chart
  const monthlyCashFlowChart: Data[] = [
    {
      x: monthlyCashFlow.months,
      y: monthlyCashFlow.deposits,
      type: 'bar',
      name: 'Deposits',
      marker: { color: '#10b981' },
    },
    {
      x: monthlyCashFlow.months,
      y: monthlyCashFlow.withdrawals,
      type: 'bar',
      name: 'Withdrawals',
      marker: { color: '#ef4444' },
    },
  ];

  const monthlyCashFlowLayout: Partial<Layout> = {
    title: { text: `Monthly Cash Flow - ${selectedCurrency}${selectedTaxYear !== 'all' ? ` (${selectedTaxYear})` : ''}` },
    xaxis: { title: { text: 'Month' } },
    yaxis: { title: { text: `${selectedCurrency} Amount` } },
    barmode: 'group',
    height: 400,
  };

  // Total Balances Pie Chart - only show currencies with non-zero balances
  const totalBalancesChart: Data[] = useMemo(() => {
    // Filter to only currencies with non-zero USD balances
    const currenciesWithBalances = fiatCurrencies.filter(currency => {
      const balance = totalBalances[currency] || 0;
      return Math.abs(balance) > 0.01; // Filter out near-zero balances
    });
    
    if (currenciesWithBalances.length === 0) {
      return [];
    }
    
    return [
      {
        labels: currenciesWithBalances,
        values: currenciesWithBalances.map(currency => Math.abs(totalBalances[currency])), // Use absolute values for pie chart
        type: 'pie',
        marker: {
          colors: currenciesWithBalances.map(currency => colorFor(currency)),
        },
        textinfo: 'label+percent',
        hovertemplate: '<b>%{label}</b><br>Balance: $%{value:,.2f}<br>Percentage: %{percent}<extra></extra>',
      },
    ];
  }, [totalBalances, fiatCurrencies, colorFor]);

  const totalBalancesLayout: Partial<Layout> = {
    title: { text: `Total Balances (USD Equivalent)${selectedTaxYear !== 'all' ? ` (${selectedTaxYear})` : ''}` },
    height: 400,
  };

  if (loadingTxs) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h1>Cash Dashboard</h1>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <AuthGuard redirectTo="/cash-dashboard">
      <main className="dashboard-container">
      <div style={{ marginBottom: '2rem', paddingBottom: '1.5rem', borderBottom: '1px solid var(--border)' }}>
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem', fontSize: '2rem', fontWeight: 800 }}>
          💰 Cash Dashboard
        </h1>
        <p className="subtitle" style={{ fontSize: '1rem', color: 'var(--muted)', marginTop: '0.5rem' }}>
          Track your fiat currency deposits, withdrawals, and cash flow over time (EUR & USD only)
        </p>
      </div>
        
        {/* Filters */}
        <div className="toolbar" style={{ marginBottom: '2rem' }}>
          <div className="filters">
            <label>
              Currency
              <select 
                value={selectedCurrency} 
                onChange={(e) => setSelectedCurrency(e.target.value)}
              >
                {fiatCurrencies.map(currency => (
                  <option key={currency} value={currency}>{currency}</option>
                ))}
              </select>
            </label>
            
            <label>
              Tax Year
              <select 
                value={selectedTaxYear} 
                onChange={(e) => setSelectedTaxYear(e.target.value)}
              >
                {availableTaxYears.map(year => (
                  <option key={year} value={year}>
                    {year === 'all' ? 'All Years' : year}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Asset Lot Strategy
              <select 
                value={selectedAssetLotStrategy} 
                onChange={(e) => setSelectedAssetLotStrategy(e.target.value as 'FIFO' | 'LIFO' | 'HIFO' | 'LOFO')}
                title="Applied when selling crypto assets (affects realized gains on sells). Romania may require FIFO; use alternatives for scenario analysis."
              >
                <option value="FIFO">FIFO</option>
                <option value="LIFO">LIFO</option>
                <option value="HIFO">HIFO (min gains)</option>
                <option value="LOFO">LOFO (max gains)</option>
              </select>
            </label>

            <label>
              Cash Lot Strategy
              <select 
                value={selectedCashLotStrategy} 
                onChange={(e) => setSelectedCashLotStrategy(e.target.value as 'FIFO' | 'LIFO' | 'HIFO' | 'LOFO')}
                title="Applied when consuming cash lots (buys + withdrawals). Use FIFO for clean chronological withdrawal traceability; try LIFO/HIFO/LOFO for scenario analysis."
              >
                <option value="FIFO">FIFO (clean trace)</option>
                <option value="LIFO">LIFO</option>
                <option value="HIFO">HIFO</option>
                <option value="LOFO">LOFO</option>
              </select>
            </label>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="dashboard-summary">
          {fiatCurrencies.map(currency => {
            const data = cashFlowData[currency];
            const totalDeposits = data.deposits;
            const totalWithdrawals = data.withdrawals;
            const netFlow = totalDeposits - totalWithdrawals;
            
            return (
              <div 
                key={currency}
                className="summary-card"
              >
                <div className="summary-label" style={{ color: colorFor(currency), fontWeight: 600 }}>
                  {currency}
                </div>
                <div className="summary-value">
                  {netFlow >= 0 ? '+' : ''}{netFlow.toFixed(2)} {currency}
                </div>
                <div className="summary-subtext">
                  Deposits: {totalDeposits.toFixed(2)} | Withdrawals: {totalWithdrawals.toFixed(2)}
                </div>
              </div>
            );
          })}
        </div>

      {/* Charts Grid */}
      <div className="dashboard-grid">
        <ChartCard title="Cash Flow by Currency" infoText="Fiat deposits vs withdrawals grouped by currency.">
          {({ timeframe, expanded }) => {
            const startIso = startIsoForTimeframe(timeframe);
            const filtered = startIso ? fiatTxs.filter((t) => new Date(t.datetime).toISOString().slice(0, 10) >= startIso) : fiatTxs;

            const fiatCurrencies = getFiatCurrencies();
            const cashFlowDataLocal: { [key: string]: { deposits: number; withdrawals: number } } = {};
            fiatCurrencies.forEach((c) => (cashFlowDataLocal[c] = { deposits: 0, withdrawals: 0 }));
            for (const tx of filtered) {
              // For deposits: fiat currency and amount are in fromAsset/fromQuantity
              // For withdrawals: fiat currency and amount are in toAsset/toQuantity
              const cur = tx.type === 'Deposit' && tx.fromAsset
                ? tx.fromAsset.toUpperCase()
                : tx.toAsset.toUpperCase();
              if (!cashFlowDataLocal[cur]) continue;
              const amount = tx.type === 'Deposit'
                ? (tx.fromQuantity || 0)
                : (tx.toQuantity || 0);
              if (tx.type === 'Deposit') cashFlowDataLocal[cur].deposits += amount;
              else if (tx.type === 'Withdrawal') cashFlowDataLocal[cur].withdrawals += amount;
            }

            const chart: Data[] = [
              { x: fiatCurrencies, y: fiatCurrencies.map((c) => cashFlowDataLocal[c].deposits), type: 'bar', name: 'Deposits', marker: { color: '#10b981' } },
              { x: fiatCurrencies, y: fiatCurrencies.map((c) => cashFlowDataLocal[c].withdrawals), type: 'bar', name: 'Withdrawals', marker: { color: '#ef4444' } },
            ];

            return <Plot data={chart} layout={{ ...cashFlowLayout, height: expanded ? undefined : 400 }} style={{ width: '100%', height: expanded ? '100%' : undefined }} />;
          }}
        </ChartCard>

        <ChartCard title="Total Cash Balance Over Time (USD)" infoText="Running fiat cash balance over time, converted to USD.">
          {({ timeframe, expanded }) => {
            const startIso = startIsoForTimeframe(timeframe);
            const idx = startIso ? (() => {
              const dates = balanceOverTime.dates;
              for (let i = 0; i < dates.length; i++) if (dates[i] >= startIso) return i;
              return dates.length;
            })() : 0;
            const dates = balanceOverTime.dates.slice(idx);
            const balances = balanceOverTime.balances.slice(idx);
            const chart: Data[] = [{ x: dates, y: balances, type: 'scatter', mode: 'lines+markers', name: 'Total Cash Balance (USD)', line: { color: '#3b82f6' }, marker: { size: 6 } }];
            return <Plot data={chart} layout={{ ...balanceOverTimeLayout, height: expanded ? undefined : 400 }} style={{ width: '100%', height: expanded ? '100%' : undefined }} />;
          }}
        </ChartCard>

        <ChartCard title={`Monthly Cash Flow - ${selectedCurrency}`} infoText={selectedCurrency === 'USD' 
          ? "Monthly deposits vs withdrawals converted to USD (includes all currencies)."
          : `Monthly deposits vs withdrawals for ${selectedCurrency}.`}>
          {({ timeframe, expanded }) => {
            const startIso = startIsoForTimeframe(timeframe);
            const filteredTxs = fiatTxs.filter((tx) => (startIso ? new Date(tx.datetime).toISOString().slice(0, 10) >= startIso : true));
            
            const monthlyData: { [key: string]: { deposits: number; withdrawals: number } } = {};
            for (const tx of filteredTxs) {
              const date = new Date(tx.datetime);
              const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
              if (!monthlyData[monthKey]) monthlyData[monthKey] = { deposits: 0, withdrawals: 0 };
              
              // Get the transaction currency and amount
              const txCurrency = tx.type === 'Deposit' && tx.fromAsset
                ? tx.fromAsset.toUpperCase()
                : tx.toAsset.toUpperCase();
              const txAmount = tx.type === 'Deposit'
                ? (tx.fromQuantity || 0)
                : (tx.toQuantity || 0);
              
              // Convert to selected currency if needed
              let amount = txAmount;
              if (txCurrency !== selectedCurrency) {
                // Convert using the transaction's price or convertFiat
                if (tx.type === 'Deposit' && tx.fromPriceUsd) {
                  // Use transaction price if available
                  amount = selectedCurrency === 'USD' 
                    ? txAmount * tx.fromPriceUsd
                    : convertFiat(txAmount, txCurrency, selectedCurrency);
                } else if (tx.type === 'Withdrawal' && tx.toPriceUsd) {
                  amount = selectedCurrency === 'USD'
                    ? txAmount * tx.toPriceUsd
                    : convertFiat(txAmount, txCurrency, selectedCurrency);
                } else {
                  // Fallback to convertFiat
                  amount = convertFiat(txAmount, txCurrency, selectedCurrency);
                }
              }
              
              if (tx.type === 'Deposit') monthlyData[monthKey].deposits += amount;
              else if (tx.type === 'Withdrawal') monthlyData[monthKey].withdrawals += amount;
            }
            const months = Object.keys(monthlyData).sort();
            const deposits = months.map((m) => monthlyData[m].deposits);
            const withdrawals = months.map((m) => monthlyData[m].withdrawals);

            const chart: Data[] = [
              { x: months, y: deposits, type: 'bar', name: 'Deposits', marker: { color: '#10b981' } },
              { x: months, y: withdrawals, type: 'bar', name: 'Withdrawals', marker: { color: '#ef4444' } },
            ];

            return <Plot data={chart} layout={{ ...monthlyCashFlowLayout, height: expanded ? undefined : 400 }} style={{ width: '100%', height: expanded ? '100%' : undefined }} />;
          }}
        </ChartCard>

        <ChartCard title="Total Balances (USD Equivalent)" infoText="Pie chart of USD-equivalent balances by fiat currency.">
          {({ timeframe, expanded }) => {
            const startIso = startIsoForTimeframe(timeframe);
            const filtered = startIso ? fiatTxs.filter((t) => new Date(t.datetime).toISOString().slice(0, 10) >= startIso) : fiatTxs;
            const fiatCurrencies = getFiatCurrencies();
            const totals: { [key: string]: number } = {};
            for (const c of fiatCurrencies) totals[c] = 0;
            for (const tx of filtered) {
              const c = tx.toAsset.toUpperCase();
              if (!(c in totals)) continue;
              if (tx.type === 'Deposit') totals[c] += tx.toQuantity;
              else if (tx.type === 'Withdrawal') totals[c] -= tx.toQuantity;
            }
            const currenciesWithBalances = fiatCurrencies.filter((c) => Math.abs(convertFiat(totals[c], c, 'USD')) > 0.01);
            if (!currenciesWithBalances.length) {
              return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>No cash balances to display</div>;
            }
            const pie: Data[] = [
              {
                labels: currenciesWithBalances,
                values: currenciesWithBalances.map((c) => Math.abs(convertFiat(totals[c], c, 'USD'))),
                type: 'pie',
                marker: { colors: currenciesWithBalances.map((c) => getAssetColor(c)) },
                textinfo: 'label+percent',
              } as unknown as Data,
            ];
            return <Plot data={pie} layout={{ ...totalBalancesLayout, height: expanded ? undefined : 400 }} style={{ width: '100%', height: expanded ? '100%' : undefined }} />;
          }}
        </ChartCard>
      </div>

      {/* Romanian Tax Report Section */}
      {selectedTaxYear !== 'all' && (
        <div style={{ marginTop: '2rem' }}>
          <h2>
            🇷🇴 Romanian Tax Report ({selectedTaxYear}) — Asset: {selectedAssetLotStrategy}, Cash: {selectedCashLotStrategy}
          </h2>
          {(selectedAssetLotStrategy !== 'FIFO' || selectedCashLotStrategy !== 'FIFO') && (
            <div style={{
              marginTop: '0.75rem',
              marginBottom: '1rem',
              padding: '0.75rem 1rem',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              backgroundColor: 'rgba(245, 158, 11, 0.12)',
              color: 'var(--text)',
              fontSize: '0.9rem',
            }}>
              <strong>Note:</strong> Romania may require <strong>FIFO</strong> for tax reporting. Other strategies are provided for
              scenario analysis (e.g., exploring tax-minimizing lot selection like HIFO).
            </div>
          )}
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            Taxable events are withdrawals from crypto to fiat. All calculations use FIFO (First In First Out) method.
            Calculations done in USD (USDC), with EUR values converted using historical FX per withdrawal date.
            <br />
            <strong>Note:</strong> Cost basis represents your original purchase price, not the sale price. 
            If cost basis &gt; withdrawals, it means you sold assets at a loss (which is correct for tax reporting).
            Cost basis only includes assets that were actually withdrawn, not unsold holdings.
          </p>

          {loadingTax ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Loading tax report...
            </div>
          ) : taxError ? (
            <div style={{
              padding: '1rem',
              borderRadius: '8px',
              border: '1px solid var(--border)',
              backgroundColor: 'rgba(239, 68, 68, 0.10)',
              color: 'var(--text)',
              marginBottom: '1rem'
            }}>
              <strong>Tax report failed to load.</strong>
              <div style={{ marginTop: '0.5rem', color: 'var(--text-secondary)' }}>
                {(taxError as Error)?.message || 'Unknown error'}
              </div>
              <div style={{ marginTop: '0.5rem', color: 'var(--text-secondary)' }}>
                This usually means historical FX rates could not be fetched. Please retry, or check server logs for the exact provider error.
              </div>
            </div>
          ) : taxReport && Array.isArray(taxReport.taxableEvents) && taxReport.taxableEvents.length > 0 ? (
            <>
              {/* Tax Summary Cards */}
              <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
                gap: '1rem', 
                marginBottom: '2rem' 
              }}>
                <div className="summary-card">
                  <div className="summary-label">Total Withdrawals</div>
                  <div className="summary-value">
                    ${taxReport.totalWithdrawalsUsd.toFixed(2)}
                  </div>
                  <div className="summary-subtext">
                    USD
                  </div>
                </div>

                <div className="summary-card">
                  <div className="summary-label">Total Cost Basis</div>
                  <div className="summary-value">
                    ${taxReport.totalCostBasisUsd.toFixed(2)}
                  </div>
                  <div className="summary-subtext">
                    USD
                  </div>
                </div>

                <div className="summary-card">
                  <div className="summary-label">Total Gain/Loss</div>
                  <div className={`summary-value ${taxReport.totalGainLossUsd >= 0 ? 'positive' : 'negative'}`}>
                    ${taxReport.totalGainLossUsd >= 0 ? '+' : ''}{taxReport.totalGainLossUsd.toFixed(2)}
                  </div>
                  <div className={`summary-subtext ${taxReport.totalGainLossUsd >= 0 ? 'positive' : 'negative'}`}>
                    USD
                  </div>
                </div>
              </div>

              {/* Diagnostic Information */}
              {taxReport.remainingCashUsd !== undefined && taxReport.remainingCashUsd > 0 && (
                <div style={{ 
                  padding: '1rem', 
                  backgroundColor: 'var(--surface)', 
                  borderRadius: '8px', 
                  border: '1px solid var(--border)',
                  marginBottom: '1rem',
                  fontSize: '0.9rem',
                  color: 'var(--text-secondary)'
                }}>
                  <strong>Note:</strong> You have {taxReport.remainingCashUsd.toFixed(2)} USD remaining in cash balance 
                  (cost basis: ${taxReport.remainingCashCostBasisUsd?.toFixed(2) || '0.00'}) that hasn&apos;t been withdrawn yet. 
                  This is <strong>not included</strong> in the tax report above - only withdrawn amounts are taxable.
                </div>
              )}

              {/* Taxable Events Table */}
              <section className="card" style={{ marginBottom: '2rem' }}>
                <div className="card-header">
                  <div className="card-title">
                    <h3 style={{ margin: 0 }}>
                      Taxable Events (Withdrawals to Fiat)
                    </h3>
                  </div>
                  <div className="card-actions">
                    <button
                      type="button"
                      onClick={(e) => {
                        try {
                          e.preventDefault();
                          e.stopPropagation();
                          const url = `/api/tax/romania/export?year=${selectedTaxYear}&assetStrategy=${selectedAssetLotStrategy}&cashStrategy=${selectedCashLotStrategy}${selectedId && selectedId !== 'all' ? `&portfolioId=${selectedId}` : ''}`;
                          triggerDownloadOnce(`tax-export-full-${selectedTaxYear}-${selectedId || 'none'}`, url);
                        } catch (error) {
                          console.error('Export failed:', error);
                        }
                      }}
                      className="btn btn-primary btn-sm"
                    >
                      📥 Export Full Report
                    </button>
                  </div>
                </div>
                <div className="table-wrapper">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th style={{ textAlign: 'right' }}>Amount (USD)</th>
                        <th style={{ textAlign: 'right' }}>Amount (Original)</th>
                        <th style={{ textAlign: 'right' }}>Cost Basis (USD)</th>
                        <th style={{ textAlign: 'right' }}>Gain/Loss (USD)</th>
                        <th style={{ textAlign: 'right' }}>Gain/Loss (Original)</th>
                        <th style={{ textAlign: 'center' }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {taxReport.taxableEvents
                        .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())
                        .map((event) => (
                          <React.Fragment key={event.transactionId}>
                            <tr>
                              <td>
                                {new Date(event.datetime).toLocaleDateString()}
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                                ${event.fiatAmountUsd.toFixed(2)}
                              </td>
                              <td style={{ textAlign: 'right', color: 'var(--muted)' }}>
                                {event.fiatCurrency !== 'USD' ? event.fiatAmountOriginal.toFixed(2) + ' ' + event.fiatCurrency : '—'}
                              </td>
                              <td style={{ textAlign: 'right' }}>
                                ${event.costBasisUsd.toFixed(2)}
                              </td>
                              <td style={{ 
                                textAlign: 'right',
                                color: event.gainLossUsd >= 0 ? '#10b981' : '#ef4444',
                                fontWeight: 'bold'
                              }}>
                                {event.gainLossUsd >= 0 ? '+' : ''}${event.gainLossUsd.toFixed(2)}
                              </td>
                              <td style={{ 
                                textAlign: 'right',
                                color: event.fiatCurrency !== 'USD' ? (event.gainLossUsd >= 0 ? '#10b981' : '#ef4444') : 'var(--muted)'
                              }}>
                                {event.fiatCurrency !== 'USD' ? (() => {
                                  const gainLossOriginal = event.gainLossUsd / event.fxFiatToUsd;
                                  return (gainLossOriginal >= 0 ? '+' : '') + gainLossOriginal.toFixed(2) + ' ' + event.fiatCurrency;
                                })() : '—'}
                              </td>
                              <td style={{ textAlign: 'center' }}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    try {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      const url = `/api/tax/romania/export?year=${selectedTaxYear}&assetStrategy=${selectedAssetLotStrategy}&cashStrategy=${selectedCashLotStrategy}&eventId=${event.transactionId}${selectedId && selectedId !== 'all' ? `&portfolioId=${selectedId}` : ''}`;
                                      triggerDownloadOnce(`tax-export-event-${event.transactionId}-${selectedTaxYear}-${selectedId || 'none'}`, url);
                                    } catch (error) {
                                      console.error('Export failed:', error);
                                    }
                                  }}
                                  className="btn btn-success btn-sm"
                                  title="Export this taxable event with source trace details"
                                >
                                  📄 Export
                                </button>
                              </td>
                            </tr>
                            {event.sourceTrace.length > 0 && (
                              <tr>
                                <td colSpan={7} style={{ padding: '0.75rem', backgroundColor: 'var(--background)', borderTop: '1px solid var(--border)' }}>
                                  <button
                                    onClick={() => setExpandedEventId(event.transactionId)}
                                    className="btn btn-secondary btn-sm"
                                    style={{ 
                                      display: 'flex', 
                                      alignItems: 'center', 
                                      gap: '0.5rem',
                                      width: '100%',
                                      justifyContent: 'center'
                                    }}
                                  >
                                    <span>📊</span>
                                    <span>Source Trace & Flow Diagram ({event.sourceTrace.length} source{event.sourceTrace.length !== 1 ? 's' : ''})</span>
                                    <span style={{ marginLeft: 'auto' }}>⛶</span>
                                  </button>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : taxReport ? (
            <div style={{ 
              padding: '2rem', 
              textAlign: 'center', 
              backgroundColor: 'var(--surface)', 
              borderRadius: '8px', 
              border: '1px solid var(--border)',
              color: 'var(--text-secondary)'
            }}>
              No taxable events (withdrawals to fiat) found for {selectedTaxYear}.
            </div>
          ) : null}
        </div>
      )}

      {/* Transaction Summary */}
      <section className="card" style={{ marginTop: '2rem' }}>
        <div className="card-header">
          <div className="card-title">
            <h2 style={{ margin: 0 }}>
              Recent Cash Transactions{selectedTaxYear !== 'all' ? ` (${selectedTaxYear})` : ''}
            </h2>
          </div>
        </div>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Currency</th>
                <th style={{ textAlign: 'right' }}>Amount</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {fiatTxs
                .sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime())
                .slice(0, 10)
                .map(tx => (
                  <tr key={tx.id}>
                    <td>
                      {new Date(tx.datetime).toLocaleDateString()}
                    </td>
                    <td>
                      <span className={`transaction-type-badge ${tx.type.toLowerCase()}`}>
                        {tx.type === 'Deposit' ? '💰' : '💸'} {tx.type}
                      </span>
                    </td>
                    <td style={{ color: colorFor(
                      (tx.type === 'Deposit' && tx.fromAsset ? tx.fromAsset : tx.toAsset).toUpperCase()
                    ), fontWeight: 600 }}>
                      {(tx.type === 'Deposit' && tx.fromAsset ? tx.fromAsset : tx.toAsset).toUpperCase()}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                      {(tx.type === 'Deposit' ? (tx.fromQuantity || 0) : (tx.toQuantity || 0)).toFixed(2)}
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: '0.9rem' }}>
                      {tx.notes || <span style={{ fontStyle: 'italic', opacity: 0.5 }}>—</span>}
                    </td>
                  </tr>
                ))}
              {fiatTxs.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--muted)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                      <span style={{ fontSize: '2rem' }}>📭</span>
                      <div style={{ fontSize: '1.1rem', fontWeight: 600 }}>No cash transactions found</div>
                      <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>Try adjusting your filters</div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Source Trace & Flow Diagram Modal */}
      {expandedEventId !== null && taxReport && (() => {
        const event = taxReport.taxableEvents.find(e => e.transactionId === expandedEventId);
        if (!event) return null;
        
        return (
          <div
            className="modal-backdrop chart-modal-backdrop"
            role="dialog"
            aria-modal="true"
            onClick={() => setExpandedEventId(null)}
          >
            <div className="modal chart-modal" onClick={(e) => e.stopPropagation()}>
              <div className="chart-modal-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontWeight: 800, fontSize: '1.1rem' }}>
                    Source Trace & Flow Diagram
                  </div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--muted)' }}>
                    {event.sourceTrace.length} source{event.sourceTrace.length !== 1 ? 's' : ''} • 
                    Withdrawal: ${event.fiatAmountUsd.toFixed(2)} • 
                    P/L: <span style={{ color: event.gainLossUsd >= 0 ? '#10b981' : '#ef4444' }}>
                      {event.gainLossUsd >= 0 ? '+' : ''}${event.gainLossUsd.toFixed(2)}
                    </span>
                  </div>
                </div>
                <button type="button" className="icon-btn" title="Close" onClick={() => setExpandedEventId(null)}>
                  ✕
                </button>
              </div>
              <div className="chart-modal-body" style={{ padding: '1.5rem', overflowY: 'auto' }}>
                <SankeyExplorer event={event} transactions={txs} onTransactionClick={(txId) => {
                  // Could navigate to transaction page or show details
                  console.log('Transaction clicked:', txId);
                }} />
              </div>
            </div>
          </div>
        );
      })()}
      </main>
    </AuthGuard>
  );
}
