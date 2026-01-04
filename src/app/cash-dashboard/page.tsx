'use client';
import useSWR from 'swr';
import React, { useCallback, useMemo, useState } from 'react';
import { usePortfolio } from '../PortfolioProvider';
import { getAssetColor, getFiatCurrencies, convertFiat } from '@/lib/assets';
import AuthGuard from '@/components/AuthGuard';
import { PlotlyChart as Plot } from '@/components/charts/plotly/PlotlyChart';

import type { Layout, Data } from 'plotly.js';
import { jsonFetcher } from '@/lib/swr-fetcher';
import type { Transaction as Tx } from '@/lib/types';
import type { RomaniaTaxReport, TaxableEvent, BuyLotTrace } from '@/lib/tax/romania';

type BuyLotTraceWithFundingSells = BuyLotTrace & {
  fundingSells?: Array<{ asset: string; amountUsd: number; costBasisUsd?: number; saleTransactionId: number; saleDatetime: string }>;
  cashSpentUsd?: number;
};

const fetcher = jsonFetcher;

/**
 * Convert taxable event source trace to Sankey diagram format
 */
function createSankeyData(event: TaxableEvent): { data: Data[]; layout: Partial<Layout> } {
  const sourceTrace = event.sourceTrace;
  
  if (sourceTrace.length === 0) {
    return {
      data: [] as Data[],
      layout: { title: { text: 'No source data available' } }
    };
  }

  // Prefer rich trace: Deposits -> Buys -> Sells -> Withdrawal (use deep trace if available)
  const saleTrace = (event.saleTraceDeep && event.saleTraceDeep.length ? event.saleTraceDeep : event.saleTrace) || [];
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
        const buyIdx = ensure(
          buyKey,
          `Buy ${lot.asset} #${lot.buyTransactionId}`,
          [
            `<b>Buy ${lot.asset}</b>`,
            `Tx: ${lot.buyTransactionId}`,
            `Date: ${buyDate}`,
            `Qty (sold from lot): ${lot.quantity.toFixed(8)}`,
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
          `<b>Buy lot → Sell</b><br>Attributed proceeds: $${lotProceedsShare.toFixed(2)}`,
          getAssetColor(lot.asset)
        );

        // Funding hops: Sell -> Buy and Deposits -> Buy (residual)
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
          const fsDate = new Date(fs.saleDatetime).toISOString().slice(0, 10);
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
              `<br>Raw: $${fs.amountUsd.toFixed(2)} • Scaled: $${(fs.amountUsd * scale).toFixed(2)}`,
            getAssetColor(fs.asset)
          );
        });

        if (depositPortionUsd > 0) {
          addEdge(
            depositsIdx,
            buyIdx,
            depositPortionUsd * scale,
            `<b>Deposits → Buy</b><br>Raw: $${depositPortionUsd.toFixed(2)} • Scaled: $${(depositPortionUsd * scale).toFixed(2)}`,
            '#64748b'
          );
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
}): SankeyExplorerData {
  const directSales = event.saleTrace || [];
  const deepSales = (event.saleTraceDeep && event.saleTraceDeep.length ? event.saleTraceDeep : directSales) || [];

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
      const buyKey = `buy:${lot.buyTransactionId}`;
      const buyIdx = ensure(
        buyKey,
        `Buy ${lot.asset} #${lot.buyTransactionId}`,
        [
          `<b>Buy ${lot.asset}</b>`,
          `Tx: ${lot.buyTransactionId}`,
          `Date: ${new Date(lot.buyDatetime).toISOString().slice(0, 10)}`,
          `Qty (portion): ${lot.quantity.toFixed(8)}`,
          `Basis (portion): $${lot.costBasisUsd.toFixed(2)}`,
        ].join('<br>')
      );

      addEdge(
        buyIdx,
        sellIdx,
        lot.costBasisUsd,
        `<b>Buy lot → Sell</b><br>Cost basis: $${lot.costBasisUsd.toFixed(2)}`,
        getAssetColor(lot.asset)
      );
      shownIncomingBasis += lot.costBasisUsd;

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

function SankeyExplorer({ event }: { event: TaxableEvent }) {
  const directSales = event.saleTrace || [];
  const rootSaleIds = useMemo(() => directSales.map((s) => s.saleTransactionId), [directSales]);
  // Start compact: show only Withdrawal + direct funding sells. Buy lots appear when you click a sell.
  const rootBuyIds = useMemo(() => [] as number[], []);

  const [visibleSaleIds, setVisibleSaleIds] = useState<number[]>(rootSaleIds);
  const [visibleBuyIds, setVisibleBuyIds] = useState<number[]>(rootBuyIds);
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
    });
  }, [event, visibleSaleIds, visibleBuyIds, showDepositTxs, showLabels, nodeThickness, nodePad]);

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
  }, [deepSales, visibleSaleIds, visibleBuyIds]);

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.75rem' }}>
        <button onClick={onReset} style={{ padding: '0.35rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--text)', cursor: 'pointer' }}>
          Reset
        </button>
        <button onClick={onExpandAll} style={{ padding: '0.35rem 0.6rem', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--background)', color: 'var(--text)', cursor: 'pointer' }}>
          Expand all
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          <input type="checkbox" checked={showDepositTxs} onChange={(e) => setShowDepositTxs(e.target.checked)} />
          Show deposit transactions
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          <input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} />
          Show labels
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Node thickness
          <input
            type="range"
            min={6}
            max={22}
            value={nodeThickness}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNodeThickness(Number(e.target.value))}
          />
          <span style={{ minWidth: 24, textAlign: 'right' }}>{nodeThickness}</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Node padding
          <input
            type="range"
            min={4}
            max={22}
            value={nodePad}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNodePad(Number(e.target.value))}
          />
          <span style={{ minWidth: 24, textAlign: 'right' }}>{nodePad}</span>
        </label>
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          Click <strong>Sell</strong> to reveal its buy lots; click <strong>Buy</strong> to reveal upstream funding sells.
        </span>
      </div>

      <Plot
        data={data.data}
        layout={data.layout}
        style={{ width: '100%' }}
        onClick={onNodeClick}
      />
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
  
  // Fetch Romania tax report for selected year
  const taxReportKey = selectedTaxYear !== 'all' 
    ? `/api/tax/romania?year=${selectedTaxYear}&assetStrategy=${selectedAssetLotStrategy}&cashStrategy=${selectedCashLotStrategy}${selectedId && selectedId !== 'all' ? `&portfolioId=${selectedId}` : ''}`
    : null;
  const { data: taxReport, isLoading: loadingTax, error: taxError } = useSWR<RomaniaTaxReport>(taxReportKey, fetcher);

  // Filter for fiat currency transactions only
  const fiatTxs = useMemo(() => {
    const fiatCurrencies = getFiatCurrencies();
    return (txs || []).filter(tx => {
      const isFiat = fiatCurrencies.includes(tx.asset.toUpperCase());
      const isCashTransaction = (tx.type === 'Deposit' || tx.type === 'Withdrawal');
      
      if (!isFiat || !isCashTransaction) return false;
      
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
    const allFiatTxs = (txs || []).filter(tx => 
      fiatCurrencies.includes(tx.asset.toUpperCase()) && 
      (tx.type === 'Deposit' || tx.type === 'Withdrawal')
    );
    
    const years = new Set<string>();
    allFiatTxs.forEach(tx => {
      const year = new Date(tx.datetime).getFullYear().toString();
      years.add(year);
    });
    
    return ['all', ...Array.from(years).sort((a, b) => b.localeCompare(a))];
  }, [txs]);

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
      const currency = tx.asset.toUpperCase();
      const amount = tx.quantity;
      const date = new Date(tx.datetime).toISOString().split('T')[0];
      
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
    const sortedTxs = [...fiatTxs].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
    
    const dates: string[] = [];
    const balances: number[] = [];
    const balancesByCurrency: Record<string, number> = {};
    
    // Initialize balances for all fiat currencies
    fiatCurrencies.forEach(currency => {
      balancesByCurrency[currency] = 0;
    });
    
    sortedTxs.forEach(tx => {
      const date = new Date(tx.datetime).toISOString().split('T')[0];
      const currency = tx.asset.toUpperCase();
      const amount = tx.quantity;
      
      if (tx.type === 'Deposit') {
        balancesByCurrency[currency] += amount;
      } else if (tx.type === 'Withdrawal') {
        balancesByCurrency[currency] -= amount;
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
  }, [fiatTxs, fiatCurrencies]);

  // Calculate monthly cash flow
  const monthlyCashFlow = useMemo(() => {
    const currency = selectedCurrency;
    const currencyTxs = fiatTxs.filter(tx => tx.asset.toUpperCase() === currency);
    
    const monthlyData: { [key: string]: { deposits: number; withdrawals: number } } = {};
    
    currencyTxs.forEach(tx => {
      const date = new Date(tx.datetime);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!monthlyData[monthKey]) {
        monthlyData[monthKey] = { deposits: 0, withdrawals: 0 };
      }
      
      if (tx.type === 'Deposit') {
        monthlyData[monthKey].deposits += tx.quantity;
      } else if (tx.type === 'Withdrawal') {
        monthlyData[monthKey].withdrawals += tx.quantity;
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
      const currencyTxs = fiatTxs.filter(tx => tx.asset.toUpperCase() === currency);
      let balance = 0;
      
      currencyTxs.forEach(tx => {
        if (tx.type === 'Deposit') {
          balance += tx.quantity;
        } else if (tx.type === 'Withdrawal') {
          balance -= tx.quantity;
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
      <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ marginBottom: '1rem' }}>💰 Cash Dashboard</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>
          Track your fiat currency deposits, withdrawals, and cash flow over time.
        </p>
        
        {/* Filters */}
        <div style={{ marginBottom: '2rem', display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div>
            <label style={{ marginRight: '1rem', fontWeight: 'bold' }}>Currency:</label>
            <select 
              value={selectedCurrency} 
              onChange={(e) => setSelectedCurrency(e.target.value)}
              style={{ 
                padding: '0.5rem', 
                borderRadius: '4px', 
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)'
              }}
            >
              {fiatCurrencies.map(currency => (
                <option key={currency} value={currency}>{currency}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label style={{ marginRight: '1rem', fontWeight: 'bold' }}>Tax Year:</label>
            <select 
              value={selectedTaxYear} 
              onChange={(e) => setSelectedTaxYear(e.target.value)}
              style={{ 
                padding: '0.5rem', 
                borderRadius: '4px', 
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)'
              }}
            >
              {availableTaxYears.map(year => (
                <option key={year} value={year}>
                  {year === 'all' ? 'All Years' : year}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ marginRight: '1rem', fontWeight: 'bold' }}>Asset Lot Strategy:</label>
            <select 
              value={selectedAssetLotStrategy} 
              onChange={(e) => setSelectedAssetLotStrategy(e.target.value as 'FIFO' | 'LIFO' | 'HIFO' | 'LOFO')}
              style={{ 
                padding: '0.5rem', 
                borderRadius: '4px', 
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)'
              }}
              title="Applied when selling crypto assets (affects realized gains on sells). Romania may require FIFO; use alternatives for scenario analysis."
            >
              <option value="FIFO">FIFO</option>
              <option value="LIFO">LIFO</option>
              <option value="HIFO">HIFO (min gains)</option>
              <option value="LOFO">LOFO (max gains)</option>
            </select>
          </div>

          <div>
            <label style={{ marginRight: '1rem', fontWeight: 'bold' }}>Cash Lot Strategy:</label>
            <select 
              value={selectedCashLotStrategy} 
              onChange={(e) => setSelectedCashLotStrategy(e.target.value as 'FIFO' | 'LIFO' | 'HIFO' | 'LOFO')}
              style={{ 
                padding: '0.5rem', 
                borderRadius: '4px', 
                border: '1px solid var(--border)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)'
              }}
              title="Applied when consuming cash lots (buys + withdrawals). Use FIFO for clean chronological withdrawal traceability; try LIFO/HIFO/LOFO for scenario analysis."
            >
              <option value="FIFO">FIFO (clean trace)</option>
              <option value="LIFO">LIFO</option>
              <option value="HIFO">HIFO</option>
              <option value="LOFO">LOFO</option>
            </select>
          </div>
        </div>

        {/* Summary Cards */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
          gap: '1rem', 
          marginBottom: '2rem' 
        }}>
          {fiatCurrencies.map(currency => {
            const data = cashFlowData[currency];
            const totalDeposits = data.deposits;
            const totalWithdrawals = data.withdrawals;
            const netFlow = totalDeposits - totalWithdrawals;
            
            return (
              <div 
                key={currency}
                style={{ 
                  padding: '1rem', 
                  backgroundColor: 'var(--surface)', 
                  borderRadius: '8px', 
                  border: '1px solid var(--border)',
                  textAlign: 'center'
                }}
              >
                <h3 style={{ margin: '0 0 0.5rem 0', color: colorFor(currency) }}>{currency}</h3>
                <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                  <div>Deposits: {totalDeposits.toFixed(2)}</div>
                  <div>Withdrawals: {totalWithdrawals.toFixed(2)}</div>
                  <div style={{ 
                    fontWeight: 'bold', 
                    color: netFlow >= 0 ? '#10b981' : '#ef4444',
                    marginTop: '0.5rem'
                  }}>
                    Net: {netFlow.toFixed(2)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Charts Grid */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', 
        gap: '2rem' 
      }}>
        {/* Cash Flow by Currency */}
        <div style={{ backgroundColor: 'var(--surface)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <Plot data={cashFlowChart} layout={cashFlowLayout} />
        </div>

        {/* Balance Over Time */}
        <div style={{ backgroundColor: 'var(--surface)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <Plot data={balanceOverTimeChart} layout={balanceOverTimeLayout} />
        </div>

        {/* Monthly Cash Flow */}
        <div style={{ backgroundColor: 'var(--surface)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
          <Plot data={monthlyCashFlowChart} layout={monthlyCashFlowLayout} />
        </div>

        {/* Total Balances Pie Chart */}
        <div style={{ backgroundColor: 'var(--surface)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border)' }}>
          {totalBalancesChart.length > 0 ? (
            <Plot data={totalBalancesChart} layout={totalBalancesLayout} />
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              No cash balances to display
            </div>
          )}
        </div>
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
            Calculations done in USD (USDC), with RON values converted using historical FX per withdrawal date (EUR→RON, USD→RON).
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
                <div style={{ 
                  padding: '1rem', 
                  backgroundColor: 'var(--surface)', 
                  borderRadius: '8px', 
                  border: '1px solid var(--border)',
                  textAlign: 'center'
                }}>
                  <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    Total Withdrawals
                  </h3>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
                    ${taxReport.totalWithdrawalsUsd.toFixed(2)}
                  </div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                    {taxReport.totalWithdrawalsRon.toFixed(2)} RON
                  </div>
                </div>

                <div style={{ 
                  padding: '1rem', 
                  backgroundColor: 'var(--surface)', 
                  borderRadius: '8px', 
                  border: '1px solid var(--border)',
                  textAlign: 'center'
                }}>
                  <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    Total Cost Basis
                  </h3>
                  <div style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>
                    ${taxReport.totalCostBasisUsd.toFixed(2)}
                  </div>
                  <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                    {taxReport.totalCostBasisRon.toFixed(2)} RON
                  </div>
                </div>

                <div style={{ 
                  padding: '1rem', 
                  backgroundColor: 'var(--surface)', 
                  borderRadius: '8px', 
                  border: '1px solid var(--border)',
                  textAlign: 'center'
                }}>
                  <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                    Total Gain/Loss
                  </h3>
                  <div style={{ 
                    fontSize: '1.5rem', 
                    fontWeight: 'bold',
                    color: taxReport.totalGainLossUsd >= 0 ? '#10b981' : '#ef4444'
                  }}>
                    ${taxReport.totalGainLossUsd >= 0 ? '+' : ''}{taxReport.totalGainLossUsd.toFixed(2)}
                  </div>
                  <div style={{ 
                    fontSize: '0.9rem', 
                    color: taxReport.totalGainLossUsd >= 0 ? '#10b981' : '#ef4444',
                    marginTop: '0.25rem'
                  }}>
                    {taxReport.totalGainLossRon >= 0 ? '+' : ''}{taxReport.totalGainLossRon.toFixed(2)} RON
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
              <div style={{ 
                backgroundColor: 'var(--surface)', 
                borderRadius: '8px', 
                border: '1px solid var(--border)',
                overflow: 'hidden',
                marginBottom: '2rem'
              }}>
                <div style={{ 
                  padding: '1rem', 
                  borderBottom: '1px solid var(--border)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}>
                  <h3 style={{ margin: 0 }}>
                    Taxable Events (Withdrawals to Fiat)
                  </h3>
                  <button
                    onClick={async () => {
                      try {
                        const url = `/api/tax/romania/export?year=${selectedTaxYear}&assetStrategy=${selectedAssetLotStrategy}&cashStrategy=${selectedCashLotStrategy}${selectedId && selectedId !== 'all' ? `&portfolioId=${selectedId}` : ''}`;
                        const response = await fetch(url);
                        if (response.ok) {
                          const blob = await response.blob();
                          const downloadUrl = window.URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = downloadUrl;
                          a.download = `romania_tax_report_${selectedTaxYear}.csv`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          window.URL.revokeObjectURL(downloadUrl);
                        }
                      } catch (error) {
                        console.error('Export failed:', error);
                      }
                    }}
                    style={{
                      padding: '0.5rem 1rem',
                      backgroundColor: '#3b82f6',
                      color: 'white',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.9rem',
                      fontWeight: 'bold'
                    }}
                  >
                    📥 Export Full Report
                  </button>
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ backgroundColor: 'var(--background)' }}>
                        <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Date</th>
                        <th style={{ padding: '0.75rem', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>Amount (USD)</th>
                        <th style={{ padding: '0.75rem', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>Amount (RON)</th>
                        <th style={{ padding: '0.75rem', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>Cost Basis (USD)</th>
                        <th style={{ padding: '0.75rem', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>Gain/Loss (USD)</th>
                        <th style={{ padding: '0.75rem', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>Gain/Loss (RON)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {taxReport.taxableEvents
                        .sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime())
                        .map((event) => (
                          <React.Fragment key={event.transactionId}>
                            <tr style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '0.75rem' }}>
                                {new Date(event.datetime).toLocaleDateString()}
                              </td>
                              <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 'bold' }}>
                                ${event.fiatAmountUsd.toFixed(2)}
                              </td>
                              <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                                {event.fiatAmountRon.toFixed(2)} RON
                              </td>
                              <td style={{ padding: '0.75rem', textAlign: 'right' }}>
                                ${event.costBasisUsd.toFixed(2)}
                              </td>
                              <td style={{ 
                                padding: '0.75rem', 
                                textAlign: 'right',
                                color: event.gainLossUsd >= 0 ? '#10b981' : '#ef4444',
                                fontWeight: 'bold'
                              }}>
                                {event.gainLossUsd >= 0 ? '+' : ''}${event.gainLossUsd.toFixed(2)}
                              </td>
                              <td style={{ 
                                padding: '0.75rem', 
                                textAlign: 'right',
                                color: event.gainLossRon >= 0 ? '#10b981' : '#ef4444'
                              }}>
                                {event.gainLossRon >= 0 ? '+' : ''}{event.gainLossRon.toFixed(2)} RON
                              </td>
                              <td style={{ padding: '0.75rem', textAlign: 'center' }}>
                                <button
                                  onClick={async () => {
                                    try {
                                      const url = `/api/tax/romania/export?year=${selectedTaxYear}&assetStrategy=${selectedAssetLotStrategy}&cashStrategy=${selectedCashLotStrategy}&eventId=${event.transactionId}${selectedId && selectedId !== 'all' ? `&portfolioId=${selectedId}` : ''}`;
                                      const response = await fetch(url);
                                      if (response.ok) {
                                        const blob = await response.blob();
                                        const downloadUrl = window.URL.createObjectURL(blob);
                                        const a = document.createElement('a');
                                        a.href = downloadUrl;
                                        a.download = `romania_tax_event_${event.transactionId}_${selectedTaxYear}.csv`;
                                        document.body.appendChild(a);
                                        a.click();
                                        document.body.removeChild(a);
                                        window.URL.revokeObjectURL(downloadUrl);
                                      }
                                    } catch (error) {
                                      console.error('Export failed:', error);
                                    }
                                  }}
                                  style={{
                                    padding: '0.25rem 0.5rem',
                                    backgroundColor: '#10b981',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                    fontSize: '0.8rem'
                                  }}
                                  title="Export this taxable event with source trace details"
                                >
                                  📄
                                </button>
                              </td>
                            </tr>
                            {event.sourceTrace.length > 0 && (
                              <tr>
                                <td colSpan={6} style={{ padding: '0', backgroundColor: 'var(--background)' }}>
                                  <details style={{ cursor: 'pointer' }}>
                                    <summary style={{ 
                                      padding: '0.75rem', 
                                      color: 'var(--text-secondary)',
                                      fontWeight: 'bold',
                                      borderTop: '1px solid var(--border)'
                                    }}>
                                      📊 Source Trace & Flow Diagram ({event.sourceTrace.length} source{event.sourceTrace.length !== 1 ? 's' : ''})
                                    </summary>
                                    <div style={{ padding: '1rem' }}>
                                      {/* Sankey Diagram */}
                                      <div style={{ 
                                        marginBottom: '1.5rem',
                                        backgroundColor: 'var(--surface)',
                                        borderRadius: '8px',
                                        padding: '1rem'
                                      }}>
                                        <SankeyExplorer event={event} />
                                      </div>
                                      
                                      {/* Detailed Source Trace */}
                                      <div style={{ marginTop: '1rem' }}>
                                        <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', color: 'var(--text)' }}>
                                          Detailed Source Breakdown:
                                        </h4>
                                        <div style={{ 
                                          display: 'grid', 
                                          gap: '0.5rem',
                                          fontSize: '0.85rem'
                                        }}>
                                          {event.sourceTrace.map((trace, traceIdx) => (
                                            <div 
                                              key={traceIdx} 
                                              style={{ 
                                                padding: '0.5rem',
                                                backgroundColor: 'var(--surface)',
                                                borderRadius: '4px',
                                                border: '1px solid var(--border)',
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center'
                                              }}
                                            >
                                              <div>
                                                <span style={{ 
                                                  fontWeight: 'bold',
                                                  color: getAssetColor(trace.asset)
                                                }}>
                                                  {trace.asset}
                                                </span>
                                                <span style={{ color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>
                                                  {trace.quantity.toFixed(4)} units
                                                </span>
                                              </div>
                                              <div style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>
                                                <div>${(trace.costBasisUsd / trace.quantity).toFixed(2)} per unit</div>
                                                <div style={{ fontWeight: 'bold', color: 'var(--text)' }}>
                                                  Cost: ${trace.costBasisUsd.toFixed(2)}
                                                </div>
                                                <div style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                                                  {new Date(trace.datetime).toLocaleDateString()}
                                                </div>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    </div>
                                  </details>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
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
      <div style={{ marginTop: '2rem' }}>
        <h2>Recent Cash Transactions{selectedTaxYear !== 'all' ? ` (${selectedTaxYear})` : ''}</h2>
        <div style={{ 
          backgroundColor: 'var(--surface)', 
          borderRadius: '8px', 
          border: '1px solid var(--border)',
          overflow: 'hidden'
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--background)' }}>
                <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Date</th>
                <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Type</th>
                <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Currency</th>
                <th style={{ padding: '0.75rem', textAlign: 'right', borderBottom: '1px solid var(--border)' }}>Amount</th>
                <th style={{ padding: '0.75rem', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {fiatTxs
                .sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime())
                .slice(0, 10)
                .map(tx => (
                  <tr key={tx.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem' }}>
                      {new Date(tx.datetime).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '0.75rem' }}>
                      <span style={{ 
                        padding: '0.25rem 0.5rem', 
                        borderRadius: '4px', 
                        fontSize: '0.8rem',
                        backgroundColor: tx.type === 'Deposit' ? '#10b98120' : '#ef444420',
                        color: tx.type === 'Deposit' ? '#10b981' : '#ef4444'
                      }}>
                        {tx.type}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem', color: colorFor(tx.asset.toUpperCase()) }}>
                      {tx.asset.toUpperCase()}
                    </td>
                    <td style={{ padding: '0.75rem', textAlign: 'right', fontWeight: 'bold' }}>
                      {tx.quantity.toFixed(2)}
                    </td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-secondary)' }}>
                      {tx.notes || '-'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </AuthGuard>
  );
}
