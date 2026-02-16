import { getAssetColor } from '@/lib/assets';
import type { Layout, Data } from 'plotly.js';
import type { TaxableEvent, BuyLotTrace } from '@/lib/tax/romania-v2';
import type { Transaction as Tx } from '@/lib/types';

export type BuyLotTraceWithFundingSells = BuyLotTrace & {
  fundingSells?: Array<{ asset: string; amountUsd: number; costBasisUsd?: number; saleTransactionId: number; saleDatetime: string }>;
  cashSpentUsd?: number;
};

export type SankeyExplorerData = { data: Data[]; layout: Partial<Layout>; nodeKeys: string[] };

/**
 * Convert taxable event source trace to Sankey diagram format
 */
export function createSankeyData(event: TaxableEvent, transactions?: Tx[]): { data: Data[]; layout: Partial<Layout> } {
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

  for (let i = 0; i < sourceTrace.length; i++) {
    const trace = sourceTrace[i];
    if (trace.swappedFromAsset && (trace.type === 'CryptoSwap' || trace.type === 'Swap')) {
      const originalLots: Array<{ buyTransactionId: number; buyDatetime: string; asset: string; quantity: number; costBasisUsd: number }> = [];
      for (let j = 0; j < i; j++) {
        const prevTrace = sourceTrace[j];
        if (prevTrace.asset === trace.swappedFromAsset &&
            prevTrace.transactionId &&
            !prevTrace.swappedFromAsset) {
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

      const saleBasis = sale.costBasisUsd;
      sale.buyLots.forEach((lot) => {
        const buyKey = `buy:${lot.buyTransactionId}`;
        const buyDate = new Date(lot.buyDatetime).toISOString().slice(0, 10);

        let swappedFromAsset = lot.swappedFromAsset;
        let swappedFromQuantity = lot.swappedFromQuantity;

        if (!swappedFromAsset) {
          const swapInfo = swapInfoByBuyTxId.get(lot.buyTransactionId);
          if (swapInfo) {
            swappedFromAsset = swapInfo.swappedFromAsset;
            swappedFromQuantity = swapInfo.swappedFromQuantity;
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

        if (isSwap) {
          let swappedFromBuyLots = originalBuyLotsBySwapTxId.get(lot.buyTransactionId);

          if (!swappedFromBuyLots || swappedFromBuyLots.length === 0) {
            swappedFromBuyLots = lot.swappedFromBuyLots;
          }

          if (swappedFromBuyLots && swappedFromBuyLots.length > 0) {
            const swapInputTotal = swappedFromBuyLots.reduce((sum, bl) => sum + bl.costBasisUsd, 0);
            const swapScale = swapInputTotal > 0 ? (lotProceedsShare / swapInputTotal) : 0;

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
          const fundingSells = (lot as BuyLotTraceWithFundingSells).fundingSells ?? [];
          const fundingFromSellsUsd = fundingSells.reduce((sum, x) => sum + (x.amountUsd || 0), 0);
          const cashSpentUsd = (lot as BuyLotTraceWithFundingSells).cashSpentUsd ?? lot.costBasisUsd;
          const depositPortionUsd = Math.max(0, cashSpentUsd - fundingFromSellsUsd);
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
          if (n.startsWith('Swap')) return '#f59e0b';
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

  // Fallback: simple asset-based aggregation
  const assetMap = new Map<string, { quantity: number; costBasis: number; datetime: string }>();

  sourceTrace.forEach(trace => {
    const existing = assetMap.get(trace.asset) || { quantity: 0, costBasis: 0, datetime: trace.datetime };
    existing.quantity += trace.quantity;
    existing.costBasis += trace.costBasisUsd;
    assetMap.set(trace.asset, existing);
  });

  const nodes: string[] = [];
  const nodeIndices = new Map<string, number>();

  assetMap.forEach((_, asset) => {
    nodeIndices.set(asset, nodes.length);
    nodes.push(asset);
  });

  const cashIndex = nodes.length;
  nodes.push('Cash (USD)');
  nodeIndices.set('Cash', cashIndex);

  const fiatIndex = nodes.length;
  nodes.push(`Withdrawal (${event.fiatAmountUsd.toFixed(2)} USD)`);
  nodeIndices.set('Withdrawal', fiatIndex);

  const sources: number[] = [];
  const targets: number[] = [];
  const values: number[] = [];
  const labels: string[] = [];
  const colors: string[] = [];

  assetMap.forEach((data, asset) => {
    sources.push(nodeIndices.get(asset)!);
    targets.push(cashIndex);
    values.push(data.costBasis);
    labels.push(`${asset}: $${data.costBasis.toFixed(2)}`);
    colors.push(getAssetColor(asset));
  });

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
      line: { color: 'black', width: 0.5 },
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
        if (idx === fiatIndex) return event.gainLossUsd >= 0 ? '#10b981' : '#ef4444';
        if (idx === cashIndex) return '#3b82f6';
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
      color: colors.map(c => c + '80')
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

export function createSankeyExplorerData(event: TaxableEvent, opts: {
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

  const swapInfoByBuyTxId = new Map<number, { swappedFromAsset?: string; swappedFromQuantity?: number; swappedFromTransactionId?: number }>();
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

  for (let i = 0; i < sourceTrace.length; i++) {
    const trace = sourceTrace[i];
    if (trace.swappedFromAsset && (trace.type === 'CryptoSwap' || trace.type === 'Swap')) {
      const originalLots: Array<{ buyTransactionId: number; buyDatetime: string; asset: string; quantity: number; costBasisUsd: number }> = [];
      for (let j = 0; j < i; j++) {
        const prevTrace = sourceTrace[j];
        if (prevTrace.asset === trace.swappedFromAsset &&
            prevTrace.transactionId &&
            !prevTrace.swappedFromAsset) {
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

      let swappedFromAsset = lot.swappedFromAsset;
      let swappedFromQuantity = lot.swappedFromQuantity;

      if (!swappedFromAsset) {
        const swapInfo = swapInfoByBuyTxId.get(lot.buyTransactionId);
        if (swapInfo) {
          swappedFromAsset = swapInfo.swappedFromAsset;
          swappedFromQuantity = swapInfo.swappedFromQuantity;
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
            const originalTx = transactions?.find((t: Tx) => t.id === lot.buyTransactionId);
            if (originalTx) {
              return `Swapped ${(originalTx.fromQuantity || swappedFromQuantity || 0).toFixed(8)} ${swappedFromAsset} → ${(originalTx.toQuantity || 0).toFixed(8)} ${lot.asset}`;
            } else {
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

      if (isSwap) {
        let swappedFromBuyLots = originalBuyLotsBySwapTxId.get(lot.buyTransactionId);

        if (!swappedFromBuyLots || swappedFromBuyLots.length === 0) {
          swappedFromBuyLots = lot.swappedFromBuyLots;
        }

        if (swappedFromBuyLots && swappedFromBuyLots.length > 0) {
          const swapInputTotal = swappedFromBuyLots.reduce((sum, bl) => sum + bl.costBasisUsd, 0);
          const swapScale = swapInputTotal > 0 ? (lot.costBasisUsd / swapInputTotal) : 0;

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
      if ((!lot.fundingDeposits || lot.fundingDeposits.length === 0) && (lot.costBasisUsd - fundingBasisFromSellsUsd) > 1e-9) {
        const key = -1;
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
