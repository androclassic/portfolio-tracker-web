/**
 * Romanian Tax Calculation - Clean Rewrite
 * 
 * Simple Model:
 * 1. Deposit (Fiat -> Stablecoin): Add to cash queue
 * 2. Swap (Crypto -> Crypto): Transfer cost basis between queues
 * 3. Withdrawal (Stablecoin -> Fiat): Remove from cash queue, calculate gain/loss
 * 
 * Core Principle: Swaps are just transfers of cost basis between asset queues.
 * No complex scaling or special cases - just straightforward FIFO lot tracking.
 */

import type { Transaction } from '@/lib/types';
import { isStablecoin } from '@/lib/types';
import { getFiatCurrencies } from '@/lib/assets';
import { getHistoricalExchangeRateSyncStrict } from '@/lib/exchange-rates';
import {
  FIFOQueue,
  createFIFOQueue,
  addToFIFO,
} from '@/lib/fifo-queue';
import type { LotStrategy } from '@/lib/tax/lot-strategy';
import { removeFromLots } from '@/lib/tax/lot-strategy';
// Type definitions
export interface TaxableEvent {
  transactionId: number;
  datetime: string;
  // Original withdrawal currency and amount (for audit)
  fiatCurrency: string;
  fiatAmountOriginal: number;
  // FX used at withdrawal date
  fxFiatToUsd: number;
  fxFiatToRon: number;
  fxUsdToRon: number;
  fiatAmountUsd: number;
  fiatAmountRon: number;
  costBasisUsd: number;
  costBasisRon: number;
  gainLossUsd: number;
  gainLossRon: number;
  // Primary trace shown in UI: the crypto buy lots that ultimately generated this withdrawal (few rows)
  sourceTrace: SourceTrace[];
  // How the withdrawn cash was generated: sell transactions and their underlying buy lots
  saleTrace?: SaleTrace[];
  // Full chain: withdrawal -> funding sells -> their buy lots -> the sells that funded those buys -> ... (recursive)
  saleTraceDeep?: SaleTrace[];
  // Optional deep trace: fiat deposits that ultimately funded the buy lots (can be huge)
  depositTrace?: SourceTrace[];
}

export interface SourceTrace {
  transactionId: number;
  asset: string;
  quantity: number;
  costBasisUsd: number;
  datetime: string;
  type: 'Deposit' | 'Swap' | 'CryptoSwap';
  pricePerUnitUsd?: number;
  originalCurrency?: string;
  exchangeRateAtPurchase?: number;
  // For crypto-to-crypto swaps: what asset was swapped from
  swappedFromAsset?: string;
  swappedFromQuantity?: number;
  swappedFromTransactionId?: number;
}

export interface BuyLotTrace {
  buyTransactionId: number;
  buyDatetime: string;
  asset: string;
  quantity: number;
  cashSpentUsd?: number; // USD cash used to acquire this lot (quantity dimension, not basis)
  costBasisUsd: number;
  fundingDeposits: SourceTrace[]; // deposits that funded this buy lot
  fundingSells?: Array<{
    saleTransactionId: number;
    saleDatetime: string;
    asset: string; // asset that was sold to fund this buy
    amountUsd: number; // USD amount from that sale used to fund this buy lot
    costBasisUsd?: number; // embedded cost basis transferred from that sale into this buy (USD)
  }>;
  // For crypto-to-crypto swaps: track what was swapped from
  swappedFromAsset?: string;
  swappedFromQuantity?: number;
  swappedFromTransactionId?: number;
  swappedFromBuyLots?: Array<{
    buyTransactionId: number;
    buyDatetime: string;
    asset: string;
    quantity: number;
    costBasisUsd: number;
  }>;
}

export interface SaleTrace {
  saleTransactionId: number;
  saleDatetime: string;
  asset: string;
  proceedsUsd: number; // allocated to this withdrawal
  costBasisUsd: number; // allocated to this withdrawal
  gainLossUsd: number; // proceedsUsd - costBasisUsd
  buyLots: BuyLotTrace[];
}

export interface RomaniaTaxReport {
  year: string;
  assetStrategy: LotStrategy;
  cashStrategy: LotStrategy;
  taxableEvents: TaxableEvent[];
  totalWithdrawalsUsd: number;
  totalWithdrawalsRon: number;
  totalCostBasisUsd: number;
  totalCostBasisRon: number;
  totalGainLossUsd: number;
  totalGainLossRon: number;
  usdToRonRate: number;
  // Diagnostic information
  remainingCashUsd?: number;
  remainingCashCostBasisUsd?: number;
  warnings?: string[];
}

type Contribution = {
  depositTxId: number;
  depositDatetime: string;
  depositCurrency: string;
  amountUsd: number;
  fxRateToUsd: number;
};

type CashMeta = {
  kind: 'deposit' | 'sale';
  contributions: Contribution[];
  sale?: {
    saleTransactionId: number;
    saleDatetime: string;
    asset: string;
    proceedsUsd: number;
    costBasisUsd: number;
    buyLots: Array<{
      buyTransactionId: number;
      buyDatetime: string;
      asset: string;
      quantity: number;
      cashSpentUsd?: number;
      costBasisUsd: number;
      contributions: Contribution[];
      fundingSells?: Array<{
        saleTransactionId: number;
        saleDatetime: string;
        asset: string;
        amountUsd: number;
        costBasisUsd?: number;
      }>;
      swappedFromAsset?: string;
      swappedFromQuantity?: number;
      swappedFromTransactionId?: number;
      swappedFromBuyLots?: Array<{
        buyTransactionId: number;
        buyDatetime: string;
        asset: string;
        quantity: number;
        costBasisUsd: number;
      }>;
    }>;
  };
};

type AssetMeta = {
  buyLots: BuyLotTrace[];
};

/**
 * Merge contributions by deposit transaction ID
 */
function mergeContributions(contribs: Contribution[]): Contribution[] {
  const map = new Map<string, Contribution>();
  for (const c of contribs) {
    const key = `${c.depositTxId}-${c.depositCurrency}`;
    const existing = map.get(key);
    if (existing) {
      existing.amountUsd += c.amountUsd;
    } else {
      map.set(key, { ...c });
    }
  }
  return Array.from(map.values()).filter((c) => c.amountUsd > 1e-9);
}

/**
 * Convert contributions to source trace
 */
function contributionsToDepositTrace(contribs: Contribution[]): SourceTrace[] {
  const merged = mergeContributions(contribs);
  return merged.map((c) => ({
    transactionId: c.depositTxId,
    asset: c.depositCurrency,
    quantity: c.amountUsd / c.fxRateToUsd,
    costBasisUsd: c.amountUsd,
    datetime: c.depositDatetime,
    type: 'Deposit',
    pricePerUnitUsd: c.fxRateToUsd,
    originalCurrency: c.depositCurrency,
    exchangeRateAtPurchase: c.fxRateToUsd,
  }));
}

/**
 * Convert buy lots to source trace for reporting
 * Includes original buy lots from swappedFromBuyLots for full chain tracing
 */
function buyLotsToSourceTrace(buyLots: BuyLotTrace[], transactions?: Transaction[]): SourceTrace[] {
  const map = new Map<number, SourceTrace>();
  const txMap = new Map<number, Transaction>();
  if (transactions) {
    for (const tx of transactions) {
      txMap.set(tx.id, tx);
    }
  }
  
  // First, add all original buy lots from swappedFromBuyLots
  // Use the scaled values from swappedFromBuyLots (the portion actually used in the swap)
  // NOT the full original transaction - if we swapped 5 SOL @ $500, show 5 SOL @ $500, not 10 SOL @ $1000
  const originalBuyTxIds = new Set<number>();
  for (const bl of buyLots) {
    if (bl.swappedFromBuyLots) {
      for (const originalLot of bl.swappedFromBuyLots) {
        if (!originalBuyTxIds.has(originalLot.buyTransactionId)) {
          originalBuyTxIds.add(originalLot.buyTransactionId);
          
          // Use the scaled values from swappedFromBuyLots - this is what was actually used
          // e.g., if we bought 10 SOL @ $1000 but only swapped 5 SOL @ $500, show 5 SOL @ $500
          map.set(originalLot.buyTransactionId, {
            transactionId: originalLot.buyTransactionId,
            asset: originalLot.asset,
            quantity: originalLot.quantity, // Scaled quantity (e.g., 5 SOL, not 10 SOL)
            costBasisUsd: originalLot.costBasisUsd, // Scaled cost basis (e.g., $500, not $1000)
            datetime: originalLot.buyDatetime,
            type: 'Swap',
            pricePerUnitUsd: originalLot.quantity > 0 ? originalLot.costBasisUsd / originalLot.quantity : undefined,
            originalCurrency: 'USD',
            exchangeRateAtPurchase: 1.0,
          });
        } else {
          // Aggregate if same transaction appears multiple times
          const existing = map.get(originalLot.buyTransactionId)!;
          existing.quantity += originalLot.quantity;
          existing.costBasisUsd += originalLot.costBasisUsd;
        }
      }
    }
  }
  
  // Then add the swap/buy transactions themselves
  for (const bl of buyLots) {
    const existing = map.get(bl.buyTransactionId);
    if (existing) {
      existing.quantity += bl.quantity;
      existing.costBasisUsd += bl.costBasisUsd;
      // Ensure datetime is set if it wasn't already
      if (!existing.datetime || existing.datetime === '') {
        existing.datetime = bl.buyDatetime;
      }
    } else {
      map.set(bl.buyTransactionId, {
        transactionId: bl.buyTransactionId,
        asset: bl.asset,
        quantity: bl.quantity,
        costBasisUsd: bl.costBasisUsd,
        datetime: bl.buyDatetime,
        type: bl.swappedFromAsset ? 'CryptoSwap' : 'Swap',
        pricePerUnitUsd: bl.quantity > 0 ? bl.costBasisUsd / bl.quantity : undefined,
        originalCurrency: 'USD',
        exchangeRateAtPurchase: 1.0,
        swappedFromAsset: bl.swappedFromAsset,
        swappedFromQuantity: bl.swappedFromQuantity,
        swappedFromTransactionId: bl.swappedFromTransactionId,
      });
    }
  }
  
  return Array.from(map.values()).sort(
    (a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()
  );
}

/**
 * Split asset meta when a lot is partially consumed
 */
function splitAssetMeta(meta: unknown, ratioUsed: number): { usedMeta: unknown; remainingMeta: unknown } {
  const m = meta as AssetMeta;
  if (!m?.buyLots?.length || ratioUsed <= 0 || ratioUsed >= 1) {
    return { usedMeta: meta, remainingMeta: meta };
  }
  
  const used: AssetMeta = {
    buyLots: m.buyLots.map((bl) => ({
      ...bl,
      quantity: bl.quantity * ratioUsed,
      cashSpentUsd: bl.cashSpentUsd === undefined ? undefined : bl.cashSpentUsd * ratioUsed,
      costBasisUsd: bl.costBasisUsd * ratioUsed,
      fundingDeposits: bl.fundingDeposits.map((d) => ({
        ...d,
        quantity: d.quantity * ratioUsed,
        costBasisUsd: d.costBasisUsd * ratioUsed,
      })),
      fundingSells: bl.fundingSells?.map((fs) => ({
        ...fs,
        amountUsd: fs.amountUsd * ratioUsed,
        costBasisUsd: fs.costBasisUsd === undefined ? undefined : fs.costBasisUsd * ratioUsed,
      })),
      swappedFromAsset: bl.swappedFromAsset,
      swappedFromQuantity: bl.swappedFromQuantity,
      swappedFromTransactionId: bl.swappedFromTransactionId,
      // Don't scale swappedFromBuyLots - preserve original transaction quantities for source trace
      swappedFromBuyLots: bl.swappedFromBuyLots,
    })),
  };
  
  const remaining: AssetMeta = {
    buyLots: m.buyLots.map((bl) => ({
      ...bl,
      quantity: bl.quantity * (1 - ratioUsed),
      cashSpentUsd: bl.cashSpentUsd === undefined ? undefined : bl.cashSpentUsd * (1 - ratioUsed),
      costBasisUsd: bl.costBasisUsd * (1 - ratioUsed),
      fundingDeposits: bl.fundingDeposits.map((d) => ({
        ...d,
        quantity: d.quantity * (1 - ratioUsed),
        costBasisUsd: d.costBasisUsd * (1 - ratioUsed),
      })),
      fundingSells: bl.fundingSells?.map((fs) => ({
        ...fs,
        amountUsd: fs.amountUsd * (1 - ratioUsed),
        costBasisUsd: fs.costBasisUsd === undefined ? undefined : fs.costBasisUsd * (1 - ratioUsed),
      })),
      swappedFromAsset: bl.swappedFromAsset,
      swappedFromQuantity: bl.swappedFromQuantity,
      swappedFromTransactionId: bl.swappedFromTransactionId,
      // Don't scale swappedFromBuyLots - preserve original transaction quantities for source trace
      swappedFromBuyLots: bl.swappedFromBuyLots,
    })),
  };
  
  return { usedMeta: used, remainingMeta: remaining };
}

/**
 * Split cash meta when a lot is partially consumed
 */
function splitCashMeta(meta: unknown, ratioUsed: number): { usedMeta: unknown; remainingMeta: unknown } {
  const m = meta as CashMeta;
  if (ratioUsed <= 0 || ratioUsed >= 1) {
    return { usedMeta: meta, remainingMeta: meta };
  }
  
  const splitSale = (s: CashMeta['sale'] | undefined, ratio: number): CashMeta['sale'] | undefined => {
    if (!s) return undefined;
    return {
      ...s,
      proceedsUsd: s.proceedsUsd * ratio,
      costBasisUsd: s.costBasisUsd * ratio,
      buyLots: s.buyLots.map((bl) => ({
        ...bl,
        quantity: bl.quantity * ratio,
        cashSpentUsd: bl.cashSpentUsd === undefined ? undefined : bl.cashSpentUsd * ratio,
        costBasisUsd: bl.costBasisUsd * ratio,
        contributions: bl.contributions.map((c) => ({ ...c, amountUsd: c.amountUsd * ratio })),
        fundingSells: bl.fundingSells?.map((fs) => ({
          ...fs,
          amountUsd: fs.amountUsd * ratio,
          costBasisUsd: fs.costBasisUsd === undefined ? undefined : fs.costBasisUsd * ratio,
        })),
        swappedFromAsset: bl.swappedFromAsset,
        swappedFromQuantity: bl.swappedFromQuantity,
        swappedFromTransactionId: bl.swappedFromTransactionId,
        swappedFromBuyLots: bl.swappedFromBuyLots?.map((sbl) => ({
          ...sbl,
          quantity: sbl.quantity * ratio,
          costBasisUsd: sbl.costBasisUsd * ratio,
        })),
      })),
    };
  };
  
  const used: CashMeta = {
    kind: m.kind,
    contributions: m.contributions.map((c) => ({
      ...c,
      amountUsd: c.amountUsd * ratioUsed,
    })),
    sale: splitSale(m.sale, ratioUsed),
  };
  
  const remaining: CashMeta = {
    kind: m.kind,
    contributions: m.contributions.map((c) => ({
      ...c,
      amountUsd: c.amountUsd * (1 - ratioUsed),
    })),
    sale: splitSale(m.sale, 1 - ratioUsed),
  };
  
  return { usedMeta: used, remainingMeta: remaining };
}

/**
 * Get USD amount for fiat transactions
 */
function getFiatUsdAmount(tx: Transaction): { amountUsd: number; fxRateToUsd: number } {
  const fiatCurrencies = getFiatCurrencies();
  const asset = tx.toAsset.toUpperCase();
  const isFiat = fiatCurrencies.includes(asset);
  if (!isFiat) return { amountUsd: 0, fxRateToUsd: 1 };

  if (asset === 'USD') {
    return { amountUsd: tx.toQuantity || 0, fxRateToUsd: 1.0 };
  }

  const fxFromTx = tx.toPriceUsd && tx.toPriceUsd > 0 ? tx.toPriceUsd : null;
  const date = new Date(Number(tx.datetime) || tx.datetime).toISOString().slice(0, 10);
  const fx = fxFromTx ?? getHistoricalExchangeRateSyncStrict(asset, 'USD', date);
  const amountUsd = (tx.toQuantity || 0) * fx;

  return { amountUsd, fxRateToUsd: fx };
}

/**
 * Main tax calculation function - Clean and Simple
 */
export function calculateRomaniaTax(
  transactions: Transaction[],
  year: string,
  usdToRonRate: number = 4.5,
  opts?: { assetStrategy?: LotStrategy; cashStrategy?: LotStrategy }
): RomaniaTaxReport {
  const assetStrategy: LotStrategy = opts?.assetStrategy ?? 'FIFO';
  const cashStrategy: LotStrategy = opts?.cashStrategy ?? 'FIFO';
  
  // Sort transactions by time
  const sortedTxs = [...transactions].sort((a, b) => {
    const ta = Number(a.datetime) || new Date(a.datetime).getTime();
    const tb = Number(b.datetime) || new Date(b.datetime).getTime();
    if (ta !== tb) return ta - tb;
    return (a.id || 0) - (b.id || 0);
  });
  
  
  const fiatCurrencies = getFiatCurrencies();
  const cashQueue: FIFOQueue = createFIFOQueue('CASH_USD');
  const assetQueues = new Map<string, FIFOQueue>();
  const saleMetaById = new Map<number, NonNullable<CashMeta['sale']>>();
  const taxableEvents: TaxableEvent[] = [];
  const warnings: string[] = [];
  
  // Process each transaction chronologically (to build queues correctly)
  // Only withdrawals from the tax year are taxable events, but we need to process
  // all transactions to build the correct queue state
  for (const tx of sortedTxs) {
    const txDate = new Date(Number(tx.datetime) || tx.datetime);
    const txYear = txDate.getFullYear().toString();
    
    
    // 1. DEPOSIT: Fiat -> Stablecoin
    // Process all deposits to build cash queue
    if (tx.type === 'Deposit') {
      const fromAsset = tx.fromAsset?.toUpperCase();
      const toAsset = tx.toAsset?.toUpperCase();
      
      if (!fromAsset || !toAsset || !fiatCurrencies.includes(fromAsset)) continue;
      if (!isStablecoin(toAsset)) {
        warnings.push(`Deposit tx ${tx.id}: toAsset ${toAsset} is not a stablecoin. Skipped.`);
        continue;
      }
      
      // Use actual stablecoin amount received (accounts for fees/exchange differences)
      // For stablecoins, price is always 1.0 USD per unit, regardless of what's stored in toPriceUsd
      // (toPriceUsd might store the fiat/USD rate, but the stablecoin itself is worth $1.0)
      const amountUsd = (tx.toQuantity || 0) * 1.0;
      if (amountUsd <= 0) continue;
      
      // Calculate FX rate for reporting
      let fxRateToUsd: number;
      if (fromAsset === 'USD') {
        fxRateToUsd = 1.0;
      } else {
        const fxFromTx = tx.fromPriceUsd && tx.fromPriceUsd > 0 ? tx.fromPriceUsd : null;
        const date = new Date(Number(tx.datetime) || tx.datetime).toISOString().slice(0, 10);
        fxRateToUsd = fxFromTx ?? getHistoricalExchangeRateSyncStrict(fromAsset, 'USD', date);
      }
      
      const contrib: Contribution = {
        depositTxId: tx.id,
        depositDatetime: tx.datetime,
        depositCurrency: fromAsset,
        amountUsd,
        fxRateToUsd,
      };
      
      const meta: CashMeta = { kind: 'deposit', contributions: [contrib] };
      const updated = addToFIFO(
        cashQueue,
        tx.id,
        amountUsd,
        amountUsd,
        tx.datetime,
        `Deposit ${fromAsset}`,
        meta
      );
      cashQueue.entries = updated.entries;
      continue;
    }
    
    // 2. SWAP: Crypto -> Crypto (transfer cost basis)
    if (tx.type === 'Swap') {
      const fromAsset = tx.fromAsset?.toUpperCase();
      const toAsset = tx.toAsset?.toUpperCase();
      const fromQty = tx.fromQuantity || 0;
      const toQty = tx.toQuantity || 0;
      
      if (!fromAsset || !toAsset || fromQty <= 0 || toQty <= 0) continue;
      
      const fromIsStable = isStablecoin(fromAsset);
      const toIsStable = isStablecoin(toAsset);
      
      // Case 1: Stablecoin -> Crypto (consume from cash, add to asset)
      if (fromIsStable && !toIsStable) {
        const spendUsd = fromQty * (tx.fromPriceUsd || 1);
        const cashBal = cashQueue.entries.reduce((s, e) => s + e.quantity, 0);
        const spendActualUsd = Math.min(spendUsd, cashBal);
        
        if (spendActualUsd <= 0) {
          warnings.push(`Swap tx ${tx.id}: insufficient cash balance. Skipped.`);
          continue;
        }
        
        if (spendActualUsd < spendUsd) {
          warnings.push(
            `Swap tx ${tx.id}: requested ${spendUsd.toFixed(2)} USD, only ${cashBal.toFixed(2)} available. Scaling.`
          );
        }
        
        // Remove from cash queue
        const { removed, remaining, totalCostBasis } = removeFromLots(
          cashQueue,
          spendActualUsd,
          { strategy: cashStrategy, splitMeta: splitCashMeta }
        );
        cashQueue.entries = remaining.entries;
        
        // Calculate actual quantity received (scaled if needed)
        const qtyRatio = spendUsd > 0 ? (spendActualUsd / spendUsd) : 1;
        const actualQty = toQty * qtyRatio;
        
        
        // Get contributions and funding sells from removed cash
        const contributions = removed.flatMap((e) => 
          ((e.meta as CashMeta | undefined)?.contributions ?? [])
        );
        
        // Track which sales funded this buy (for deep tracing)
        const fundingSellsMap = new Map<number, { saleTransactionId: number; saleDatetime: string; asset: string; amountUsd: number; costBasisUsd: number }>();
        for (const e of removed) {
          const s = (e.meta as CashMeta | undefined)?.sale;
          if (!s) continue;
          const prev = fundingSellsMap.get(s.saleTransactionId);
          if (!prev) {
            fundingSellsMap.set(s.saleTransactionId, {
              saleTransactionId: s.saleTransactionId,
              saleDatetime: s.saleDatetime,
              asset: s.asset,
              amountUsd: e.quantity,
              costBasisUsd: e.costBasisUsd,
            });
          } else {
            prev.amountUsd += e.quantity;
            prev.costBasisUsd += e.costBasisUsd;
          }
        }
        const fundingSells = Array.from(fundingSellsMap.values()).filter((x) => x.amountUsd > 1e-9);
        
        // Add to asset queue
        if (!assetQueues.has(toAsset)) {
          assetQueues.set(toAsset, createFIFOQueue(toAsset));
        }
        const assetQueue = assetQueues.get(toAsset)!;
        
        const meta: AssetMeta = {
          buyLots: [{
            buyTransactionId: tx.id,
            buyDatetime: tx.datetime,
            asset: toAsset,
            quantity: actualQty,
            cashSpentUsd: spendActualUsd,
            costBasisUsd: totalCostBasis,
            fundingDeposits: contributions.map((c) => ({
              transactionId: c.depositTxId,
              asset: c.depositCurrency,
              quantity: c.amountUsd / c.fxRateToUsd,
              costBasisUsd: c.amountUsd,
              datetime: c.depositDatetime,
              type: 'Deposit',
              pricePerUnitUsd: c.fxRateToUsd,
              originalCurrency: c.depositCurrency,
              exchangeRateAtPurchase: c.fxRateToUsd,
            })),
            fundingSells: fundingSells.length > 0 ? fundingSells : undefined,
            swappedFromAsset: fromAsset,
            swappedFromQuantity: fromQty * qtyRatio,
            swappedFromTransactionId: tx.id,
          }],
        };
        
        const updatedAssetQueue = addToFIFO(
          assetQueue,
          tx.id,
          actualQty,
          totalCostBasis,
          tx.datetime,
          `Buy ${toAsset}`,
          meta
        );
        assetQueues.set(toAsset, updatedAssetQueue);
        continue;
      }
      
      // Case 2: Crypto -> Stablecoin (consume from asset, add to cash)
      if (!fromIsStable && toIsStable) {
        if (!assetQueues.has(fromAsset)) {
          warnings.push(`Swap tx ${tx.id}: no holdings for ${fromAsset}. Skipped.`);
          continue;
        }
        
        const assetQueue = assetQueues.get(fromAsset)!;
        const assetBal = assetQueue.entries.reduce((s, e) => s + e.quantity, 0);
        const actualFromQty = Math.min(fromQty, assetBal);
        
        if (actualFromQty <= 0) {
          warnings.push(`Swap tx ${tx.id}: insufficient ${fromAsset} balance. Skipped.`);
          continue;
        }
        
        // Remove from asset queue
        const { removed, remaining, totalCostBasis } = removeFromLots(
          assetQueue,
          actualFromQty,
          { strategy: assetStrategy, splitMeta: splitAssetMeta }
        );
        assetQueues.set(fromAsset, remaining);
        
        // Calculate actual stablecoin received (scaled if needed)
        const qtyRatio = fromQty > 0 ? (actualFromQty / fromQty) : 1;
        const actualToQty = toQty * qtyRatio;
        const proceedsUsd = actualToQty * (tx.toPriceUsd || 1);
        
        
        // Get buy lots from removed assets
        const removedBuyLots = removed.flatMap((e) => 
          ((e.meta as AssetMeta | undefined)?.buyLots ?? [])
        );
        
        // Merge contributions from all buy lots
        // Contributions are stored in fundingDeposits as SourceTrace[], need to convert back
        const contributionMap = new Map<number, Contribution>();
        for (const bl of removedBuyLots) {
          for (const deposit of bl.fundingDeposits || []) {
            const existing = contributionMap.get(deposit.transactionId);
            if (existing) {
              existing.amountUsd += deposit.costBasisUsd;
            } else {
              // Convert SourceTrace back to Contribution
              contributionMap.set(deposit.transactionId, {
                depositTxId: deposit.transactionId,
                depositDatetime: deposit.datetime,
                depositCurrency: deposit.asset,
                amountUsd: deposit.costBasisUsd,
                fxRateToUsd: deposit.exchangeRateAtPurchase || 1.0,
              });
            }
          }
        }
        const contributions = mergeContributions(Array.from(contributionMap.values()));
        
        // Store sale metadata for deep tracing
        const saleMeta: NonNullable<CashMeta['sale']> = {
          saleTransactionId: tx.id,
          saleDatetime: tx.datetime,
          asset: fromAsset,
          proceedsUsd,
          costBasisUsd: totalCostBasis,
          buyLots: removedBuyLots.map((bl) => ({
            buyTransactionId: bl.buyTransactionId,
            buyDatetime: bl.buyDatetime,
            asset: bl.asset,
            quantity: bl.quantity,
            cashSpentUsd: bl.cashSpentUsd,
            costBasisUsd: bl.costBasisUsd,
            contributions: bl.fundingDeposits.map((d) => ({
              depositTxId: d.transactionId,
              depositDatetime: d.datetime,
              depositCurrency: d.asset,
              amountUsd: d.costBasisUsd,
              fxRateToUsd: d.exchangeRateAtPurchase || 1.0,
            })),
            fundingSells: bl.fundingSells,
            swappedFromAsset: bl.swappedFromAsset,
            swappedFromQuantity: bl.swappedFromQuantity,
            swappedFromTransactionId: bl.swappedFromTransactionId,
            swappedFromBuyLots: bl.swappedFromBuyLots,
          })),
        };
        saleMetaById.set(tx.id, saleMeta);
        
        // Add to cash queue with transferred cost basis
        const meta: CashMeta = {
          kind: 'sale',
          contributions,
          sale: saleMeta,
        };
        
        const updatedCashQueue = addToFIFO(
          cashQueue,
          tx.id,
          proceedsUsd,
          totalCostBasis, // Cost basis transferred from asset
          tx.datetime,
          `Sell ${fromAsset}`,
          meta
        );
        cashQueue.entries = updatedCashQueue.entries;
        continue;
      }
      
      // Case 3: Crypto -> Crypto (transfer cost basis between assets)
      if (!fromIsStable && !toIsStable) {
        if (!assetQueues.has(fromAsset)) {
          warnings.push(`Swap tx ${tx.id}: no holdings for ${fromAsset}. Skipped.`);
          continue;
        }
        
        const fromQueue = assetQueues.get(fromAsset)!;
        const fromBal = fromQueue.entries.reduce((s, e) => s + e.quantity, 0);
        const actualFromQty = Math.min(fromQty, fromBal);
        
        if (actualFromQty <= 0) {
          warnings.push(`Swap tx ${tx.id}: insufficient ${fromAsset} balance. Skipped.`);
          continue;
        }
        
        // Remove from source asset
        const { removed, remaining, totalCostBasis } = removeFromLots(
          fromQueue,
          actualFromQty,
          { strategy: assetStrategy, splitMeta: splitAssetMeta }
        );
        assetQueues.set(fromAsset, remaining);
        
        // Get buy lots from removed assets (for tracking swap chain)
        const removedBuyLots = removed.flatMap((e) => 
          ((e.meta as AssetMeta | undefined)?.buyLots ?? [])
        );
        
        // Calculate actual quantity received (scaled if needed)
        const qtyRatio = fromQty > 0 ? (actualFromQty / fromQty) : 1;
        const actualToQty = toQty * qtyRatio;
        
        // Add to target asset with transferred cost basis
        if (!assetQueues.has(toAsset)) {
          assetQueues.set(toAsset, createFIFOQueue(toAsset));
        }
        const toQueue = assetQueues.get(toAsset)!;
        
        // Track swap chain
        const swappedFromBuyLots = removedBuyLots.map((bl) => ({
          buyTransactionId: bl.buyTransactionId,
          buyDatetime: bl.buyDatetime,
          asset: bl.asset,
          quantity: bl.quantity,
          costBasisUsd: bl.costBasisUsd,
        }));
        
        // Merge funding deposits from removed buy lots
        const fundingDepositsMap = new Map<number, SourceTrace>();
        for (const bl of removedBuyLots) {
          for (const deposit of bl.fundingDeposits || []) {
            const existing = fundingDepositsMap.get(deposit.transactionId);
            if (existing) {
              existing.quantity += deposit.quantity;
              existing.costBasisUsd += deposit.costBasisUsd;
            } else {
              fundingDepositsMap.set(deposit.transactionId, { ...deposit });
            }
          }
        }
        const fundingDeposits = Array.from(fundingDepositsMap.values());
        
        const meta: AssetMeta = {
          buyLots: [{
            buyTransactionId: tx.id,
            buyDatetime: tx.datetime,
            asset: toAsset,
            quantity: actualToQty,
            costBasisUsd: totalCostBasis,
            fundingDeposits,
            swappedFromAsset: fromAsset,
            swappedFromQuantity: actualFromQty,
            swappedFromTransactionId: tx.id,
            swappedFromBuyLots: swappedFromBuyLots.length > 0 ? swappedFromBuyLots : undefined,
          }],
        };
        
        const updatedToQueue = addToFIFO(
          toQueue,
          tx.id,
          actualToQty,
          totalCostBasis,
          tx.datetime,
          `Swap ${fromAsset}→${toAsset}`,
          meta
        );
        assetQueues.set(toAsset, updatedToQueue);
        continue;
      }
      
      // Stablecoin -> Stablecoin swaps are not common but handled as cash transfers
      if (fromIsStable && toIsStable) {
        warnings.push(`Swap tx ${tx.id}: stablecoin-to-stablecoin swap. Not processed.`);
        continue;
      }
    }
    
    // 3. WITHDRAWAL: Stablecoin -> Fiat (taxable event)
    if (tx.type === 'Withdrawal') {
      const fromAsset = tx.fromAsset?.toUpperCase();
      const toAsset = tx.toAsset?.toUpperCase();
      
      if (!fromAsset || !toAsset || !isStablecoin(fromAsset) || !fiatCurrencies.includes(toAsset)) {
        continue;
      }
      
      // For withdrawals: USD value is based on the stablecoin amount (fromQuantity), not the fiat amount
      // Stablecoins are always worth $1.00 per unit
      const amountUsd = (tx.fromQuantity || 0) * 1.0;
      if (amountUsd <= 0) continue;
      
      // Get exchange rate for reporting (fiat to USD)
      const { fxRateToUsd } = getFiatUsdAmount(tx);
      
      // Get withdrawal amount in RON
      const fxUsdToRon = usdToRonRate;
      const fxFiatToRon = fxRateToUsd * fxUsdToRon;
      const amountRon = (tx.toQuantity || 0) * fxFiatToRon;
      
      // Remove from cash queue
      const cashBal = cashQueue.entries.reduce((s, e) => s + e.quantity, 0);
      const withdrawActualUsd = Math.min(amountUsd, cashBal);
      
      let costBasisUsd = 0;
      let contributions: Contribution[] = [];
      let removed: ReturnType<typeof removeFromLots>['removed'] = [];
      
      if (withdrawActualUsd > 0) {
        const result = removeFromLots(
          cashQueue,
          withdrawActualUsd,
          { strategy: cashStrategy, splitMeta: splitCashMeta }
        );
        cashQueue.entries = result.remaining.entries;
        removed = result.removed;
        
        costBasisUsd = result.totalCostBasis;
        contributions = mergeContributions(
          removed.flatMap((e) => ((e.meta as CashMeta | undefined)?.contributions ?? []))
        );
      } else {
        warnings.push(
          `Withdrawal tx ${tx.id}: cash balance is 0. Cost basis set to 0 (full amount is gain).`
        );
      }
      
      const depositTrace: SourceTrace[] = contributionsToDepositTrace(contributions);
      
      // Build sell->buy traceability for "how you made the money"
      const saleEntries = removed.length > 0
        ? removed
            .map((e) => (e.meta as CashMeta | undefined)?.sale)
            .filter((s): s is NonNullable<CashMeta['sale']> => Boolean(s))
        : [];
      
      const saleMap = new Map<number, SaleTrace>();
      for (const s of saleEntries) {
        const prev = saleMap.get(s.saleTransactionId);
        if (!prev) {
          saleMap.set(s.saleTransactionId, {
            saleTransactionId: s.saleTransactionId,
            saleDatetime: s.saleDatetime,
            asset: s.asset,
            proceedsUsd: s.proceedsUsd,
            costBasisUsd: s.costBasisUsd,
            gainLossUsd: s.proceedsUsd - s.costBasisUsd,
            buyLots: [],
          });
        } else {
          prev.proceedsUsd += s.proceedsUsd;
          prev.costBasisUsd += s.costBasisUsd;
          prev.gainLossUsd = prev.proceedsUsd - prev.costBasisUsd;
        }
        
        const agg = saleMap.get(s.saleTransactionId)!;
        // Merge buy lots by buy tx id
        const buyMap = new Map<number, BuyLotTrace>();
        for (const bl of agg.buyLots) buyMap.set(bl.buyTransactionId, bl);
        
        for (const bl of s.buyLots) {
          const existing = buyMap.get(bl.buyTransactionId);
          if (!existing) {
            buyMap.set(bl.buyTransactionId, {
              buyTransactionId: bl.buyTransactionId,
              buyDatetime: bl.buyDatetime,
              asset: bl.asset,
              quantity: bl.quantity,
              cashSpentUsd: bl.cashSpentUsd,
              costBasisUsd: bl.costBasisUsd,
              fundingDeposits: contributionsToDepositTrace(bl.contributions),
              fundingSells: bl.fundingSells,
              swappedFromAsset: bl.swappedFromAsset,
              swappedFromQuantity: bl.swappedFromQuantity,
              swappedFromTransactionId: bl.swappedFromTransactionId,
              swappedFromBuyLots: bl.swappedFromBuyLots,
            });
          } else {
            existing.quantity += bl.quantity;
            existing.cashSpentUsd = (existing.cashSpentUsd ?? 0) + (bl.cashSpentUsd ?? 0);
            existing.costBasisUsd += bl.costBasisUsd;
            // Merge deposit traces
            const mergedFunding = contributionsToDepositTrace(
              mergeContributions([
                ...existing.fundingDeposits.map((d) => ({
                  depositTxId: d.transactionId,
                  depositDatetime: d.datetime,
                  depositCurrency: d.asset,
                  amountUsd: d.costBasisUsd,
                  fxRateToUsd: d.exchangeRateAtPurchase ?? 1,
                })),
                ...bl.contributions,
              ])
            );
            existing.fundingDeposits = mergedFunding;
            
            // Merge funding sells
            if (bl.fundingSells && bl.fundingSells.length) {
              const m = new Map<number, typeof bl.fundingSells[0]>();
              (existing.fundingSells || []).forEach((x) => m.set(x.saleTransactionId, { ...x }));
              bl.fundingSells.forEach((x) => {
                const prev = m.get(x.saleTransactionId);
                if (!prev) m.set(x.saleTransactionId, { ...x });
                else {
                  prev.amountUsd += x.amountUsd;
                  if (x.costBasisUsd !== undefined) prev.costBasisUsd = (prev.costBasisUsd || 0) + x.costBasisUsd;
                }
              });
              existing.fundingSells = Array.from(m.values());
            }
            
            // Preserve swap information
            if (!existing.swappedFromAsset && bl.swappedFromAsset) {
              existing.swappedFromAsset = bl.swappedFromAsset;
              existing.swappedFromQuantity = bl.swappedFromQuantity;
              existing.swappedFromTransactionId = bl.swappedFromTransactionId;
              existing.swappedFromBuyLots = bl.swappedFromBuyLots;
            }
          }
        }
        agg.buyLots = Array.from(buyMap.values());
      }
      
      const saleTrace = Array.from(saleMap.values()).sort(
        (a, b) => new Date(a.saleDatetime).getTime() - new Date(b.saleDatetime).getTime()
      );
      
      // Expand to full chain using saleMetaById + fundingSells recursively
      const buildSaleTraceDeep = (): SaleTrace[] => {
        const wantedBySale = new Map<number, number>();
        const pushWanted = (saleId: number, amt: number) => {
          if (!Number.isFinite(amt) || amt <= 1e-9) return;
          wantedBySale.set(saleId, (wantedBySale.get(saleId) || 0) + amt);
        };
        for (const s of saleTrace) pushWanted(s.saleTransactionId, s.proceedsUsd);
        
        const processedRatio = new Map<number, number>();
        const queue: number[] = Array.from(wantedBySale.keys());
        const inQueue = new Set<number>(queue);
        
        while (queue.length) {
          const saleId = queue.shift()!;
          inQueue.delete(saleId);
          const meta = saleMetaById.get(saleId);
          if (!meta || meta.proceedsUsd <= 1e-9) continue;
          const wanted = Math.min(meta.proceedsUsd, wantedBySale.get(saleId) || 0);
          const ratio = wanted / meta.proceedsUsd;
          const prevRatio = processedRatio.get(saleId) || 0;
          if (ratio <= prevRatio + 1e-12) continue;
          processedRatio.set(saleId, ratio);
          
          const delta = ratio - prevRatio;
          for (const bl of meta.buyLots) {
            const fs = bl.fundingSells || [];
            for (const f of fs) {
              pushWanted(f.saleTransactionId, (f.amountUsd || 0) * delta);
              if (!inQueue.has(f.saleTransactionId)) {
                queue.push(f.saleTransactionId);
                inQueue.add(f.saleTransactionId);
              }
            }
          }
        }
        
        const out: SaleTrace[] = [];
        for (const [saleId, wantedRaw] of wantedBySale.entries()) {
          const meta = saleMetaById.get(saleId);
          if (!meta || meta.proceedsUsd <= 1e-9) continue;
          const proceedsUsd = Math.min(meta.proceedsUsd, wantedRaw);
          const ratio = proceedsUsd / meta.proceedsUsd;
          const costBasisUsd = meta.costBasisUsd * ratio;
          const buyLots: BuyLotTrace[] = meta.buyLots.map((bl) => ({
            buyTransactionId: bl.buyTransactionId,
            buyDatetime: bl.buyDatetime,
            asset: bl.asset,
            quantity: bl.quantity * ratio,
            cashSpentUsd: bl.cashSpentUsd === undefined ? undefined : bl.cashSpentUsd * ratio,
            costBasisUsd: bl.costBasisUsd * ratio,
            fundingDeposits: contributionsToDepositTrace(
              bl.contributions.map((c) => ({ ...c, amountUsd: c.amountUsd * ratio }))
            ),
            fundingSells: bl.fundingSells
              ? bl.fundingSells.map((fs) => ({
                  ...fs,
                  amountUsd: fs.amountUsd * ratio,
                  costBasisUsd: fs.costBasisUsd === undefined ? undefined : fs.costBasisUsd * ratio,
                }))
              : undefined,
            swappedFromAsset: bl.swappedFromAsset,
            swappedFromQuantity: bl.swappedFromQuantity,
            swappedFromTransactionId: bl.swappedFromTransactionId,
            swappedFromBuyLots: bl.swappedFromBuyLots
              ? bl.swappedFromBuyLots.map((sbl) => ({
                  ...sbl,
                  quantity: sbl.quantity * ratio,
                  costBasisUsd: sbl.costBasisUsd * ratio,
                }))
              : undefined,
          }));
          out.push({
            saleTransactionId: saleId,
            saleDatetime: meta.saleDatetime,
            asset: meta.asset,
            proceedsUsd,
            costBasisUsd,
            gainLossUsd: proceedsUsd - costBasisUsd,
            buyLots,
          });
        }
        return out.sort((a, b) => new Date(a.saleDatetime).getTime() - new Date(b.saleDatetime).getTime());
      };
      
      const saleTraceDeep = buildSaleTraceDeep();
      
      // Build source trace from buy lots
      // Use saleTraceDeep to include all funding sells, but get original unscaled values from saleMetaById
      const allBuyLots: BuyLotTrace[] = [];
      const processedBuyTxIds = new Set<number>();
      
      // Collect buy lots from saleTraceDeep (includes funding sells)
      const saleIds = new Set<number>();
      for (const s of saleTraceDeep.length > 0 ? saleTraceDeep : saleTrace) {
        saleIds.add(s.saleTransactionId);
      }
      
      // Recursively collect all funding sells
      const collectFundingSells = (saleId: number) => {
        if (saleIds.has(saleId)) return;
        saleIds.add(saleId);
        const meta = saleMetaById.get(saleId);
        if (!meta) return;
        for (const bl of meta.buyLots) {
          if (bl.fundingSells) {
            for (const fs of bl.fundingSells) {
              collectFundingSells(fs.saleTransactionId);
            }
          }
        }
      };
      
      for (const saleId of Array.from(saleIds)) {
        collectFundingSells(saleId);
      }
      
      // Collect buy lots from all relevant sales (use original unscaled values from saleMetaById)
      for (const saleId of saleIds) {
        const meta = saleMetaById.get(saleId);
        if (!meta) continue;
        for (const bl of meta.buyLots) {
          if (!processedBuyTxIds.has(bl.buyTransactionId)) {
            processedBuyTxIds.add(bl.buyTransactionId);
            allBuyLots.push({
              buyTransactionId: bl.buyTransactionId,
              buyDatetime: bl.buyDatetime,
              asset: bl.asset,
              quantity: bl.quantity, // Original unscaled quantity
              cashSpentUsd: bl.cashSpentUsd,
              costBasisUsd: bl.costBasisUsd, // Original unscaled cost basis
              fundingDeposits: contributionsToDepositTrace(bl.contributions),
              fundingSells: bl.fundingSells,
              swappedFromAsset: bl.swappedFromAsset,
              swappedFromQuantity: bl.swappedFromQuantity,
              swappedFromTransactionId: bl.swappedFromTransactionId,
              swappedFromBuyLots: bl.swappedFromBuyLots, // Original unscaled swappedFromBuyLots
            });
          }
        }
      }
      
      const sourceTrace = buyLotsToSourceTrace(allBuyLots, sortedTxs);
      
      // Only add to taxable events if this withdrawal is from the selected tax year
      if (txYear === year) {
        const costBasisRon = costBasisUsd * fxUsdToRon;
        const gainLossUsd = amountUsd - costBasisUsd;
        const gainLossRon = amountRon - costBasisRon;
        
        const taxableEvent: TaxableEvent = {
          transactionId: tx.id,
          datetime: tx.datetime,
          fiatCurrency: toAsset,
          fiatAmountOriginal: tx.toQuantity || 0,
          fxFiatToUsd: fxRateToUsd,
          fxFiatToRon: fxFiatToRon,
          fxUsdToRon: fxUsdToRon,
          fiatAmountUsd: amountUsd,
          fiatAmountRon: amountRon,
          costBasisUsd,
          costBasisRon,
          gainLossUsd,
          gainLossRon,
          sourceTrace,
          saleTrace: saleTrace.length > 0 ? saleTrace : undefined,
          saleTraceDeep: saleTraceDeep.length > 0 ? saleTraceDeep : undefined,
          depositTrace: depositTrace.length > 0 ? depositTrace : undefined,
        };
        
        taxableEvents.push(taxableEvent);
      }
      continue;
    }
  }
  
  // Calculate totals
  const totalWithdrawalsUsd = taxableEvents.reduce((sum, e) => sum + e.fiatAmountUsd, 0);
  const totalWithdrawalsRon = taxableEvents.reduce((sum, e) => sum + e.fiatAmountRon, 0);
  const totalCostBasisUsd = taxableEvents.reduce((sum, e) => sum + e.costBasisUsd, 0);
  const totalCostBasisRon = taxableEvents.reduce((sum, e) => sum + e.costBasisRon, 0);
  const totalGainLossUsd = taxableEvents.reduce((sum, e) => sum + e.gainLossUsd, 0);
  const totalGainLossRon = taxableEvents.reduce((sum, e) => sum + e.gainLossRon, 0);
  
  const remainingCashUsd = cashQueue.entries.reduce((sum, e) => sum + e.quantity, 0);
  const remainingCashCostBasisUsd = cashQueue.entries.reduce((sum, e) => sum + e.costBasisUsd, 0);
  
  return {
    year,
    assetStrategy,
    cashStrategy,
    taxableEvents,
    totalWithdrawalsUsd,
    totalWithdrawalsRon,
    totalCostBasisUsd,
    totalCostBasisRon,
    totalGainLossUsd,
    totalGainLossRon,
    usdToRonRate,
    remainingCashUsd,
    remainingCashCostBasisUsd,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

