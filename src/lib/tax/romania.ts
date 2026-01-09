/**
 * Romanian Tax Calculation (FIFO)
 *
 * Transaction Model:
 * - `Deposit`: Fiat -> Stablecoin (typically USDC). Adds to cash queue.
 * - `Swap`: All crypto-to-crypto transactions (including stablecoin ↔ crypto).
 *   - Stablecoin -> Crypto: Consumes from cash queue, adds to asset queue (transfers cost basis).
 *   - Crypto -> Stablecoin: Consumes from asset queue, adds to cash queue (transfers cost basis).
 *   - Crypto -> Crypto: Consumes from one asset queue, adds to another (transfers cost basis).
 * - `Withdrawal`: Stablecoin -> Fiat. Consumes cash lots for gain/loss calculation.
 *
 * Key insight: At the end of the day, any transaction besides deposits and withdrawals 
 * are crypto-to-crypto transactions (swaps). This makes tracing easier to follow.
 *
 * We model this like an accountant:
 * - Maintain a FIFO **cash queue** in USD-equivalent (for stablecoins).
 *   - Deposits add principal cash lots (cost basis == amount).
 *   - Swaps to stablecoin add cash lots whose cost basis comes from the crypto lots swapped (basis transfer).
 *   - Swaps from stablecoin consume cash lots (transferring their embedded cost basis into the acquired crypto lots).
 *   - Withdrawals consume cash lots; the consumed cost basis is used for gain/loss.
 * - Maintain FIFO **asset queues** for each crypto asset (non-stablecoin).
 *
 * Taxable events (per your request): fiat withdrawals.
 * All calculations are done in USD and converted to RON only at the end.
 */

import type { Transaction } from '@/lib/types';
import { STABLECOINS, isStablecoin } from '@/lib/types';
import { getFiatCurrencies } from '@/lib/assets';
import { getHistoricalExchangeRateSyncStrict } from '@/lib/exchange-rates';
import {
  FIFOQueue,
  createFIFOQueue,
  addToFIFO,
} from '@/lib/fifo-queue';
import type { LotStrategy } from '@/lib/tax/lot-strategy';
import { removeFromLots } from '@/lib/tax/lot-strategy';

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
  fxRateToUsd: number; // USD per 1 unit depositCurrency
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
    }>;
  };
};

type AssetMeta = {
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
  }>;
};

function mergeContributions(contribs: Contribution[]): Contribution[] {
  const map = new Map<string, Contribution>();
  for (const c of contribs) {
    const key = `${c.depositTxId}|${c.fxRateToUsd}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...c });
    } else {
      prev.amountUsd += c.amountUsd;
      map.set(key, prev);
    }
  }
  return Array.from(map.values()).filter((c) => c.amountUsd > 1e-9);
}

function splitCashMeta(meta: unknown, ratioUsed: number): { usedMeta: unknown; remainingMeta: unknown } {
  const m = meta as CashMeta;
  if (!m?.contributions?.length || ratioUsed <= 0 || ratioUsed >= 1) {
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
        fundingSells: bl.fundingSells
          ? bl.fundingSells.map((fs) => ({
              ...fs,
              amountUsd: fs.amountUsd * ratio,
              costBasisUsd: fs.costBasisUsd === undefined ? undefined : fs.costBasisUsd * ratio,
            }))
          : undefined,
      })),
    };
  };
  const used: CashMeta = {
    ...m,
    contributions: m.contributions.map((c) => ({ ...c, amountUsd: c.amountUsd * ratioUsed })),
    sale: splitSale(m.sale, ratioUsed),
  };
  const remaining: CashMeta = {
    ...m,
    contributions: m.contributions.map((c) => ({ ...c, amountUsd: c.amountUsd * (1 - ratioUsed) })),
    sale: splitSale(m.sale, 1 - ratioUsed),
  };
  return { usedMeta: used, remainingMeta: remaining };
}

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
      contributions: bl.contributions.map((c) => ({ ...c, amountUsd: c.amountUsd * ratioUsed })),
      fundingSells: bl.fundingSells
        ? bl.fundingSells.map((fs) => ({
            ...fs,
            amountUsd: fs.amountUsd * ratioUsed,
            costBasisUsd: fs.costBasisUsd === undefined ? undefined : fs.costBasisUsd * ratioUsed,
          }))
        : undefined,
      // Preserve swap information (don't scale these - they're metadata about the swap)
      swappedFromAsset: bl.swappedFromAsset,
      swappedFromQuantity: bl.swappedFromQuantity,
      swappedFromTransactionId: bl.swappedFromTransactionId,
      // Scale swappedFromBuyLots quantities and cost basis
      swappedFromBuyLots: bl.swappedFromBuyLots
        ? bl.swappedFromBuyLots.map((sbl) => ({
            ...sbl,
            quantity: sbl.quantity * ratioUsed,
            costBasisUsd: sbl.costBasisUsd * ratioUsed,
          }))
        : undefined,
    })),
  };
  const remaining: AssetMeta = {
    buyLots: m.buyLots.map((bl) => ({
      ...bl,
      quantity: bl.quantity * (1 - ratioUsed),
      cashSpentUsd: bl.cashSpentUsd === undefined ? undefined : bl.cashSpentUsd * (1 - ratioUsed),
      costBasisUsd: bl.costBasisUsd * (1 - ratioUsed),
      contributions: bl.contributions.map((c) => ({ ...c, amountUsd: c.amountUsd * (1 - ratioUsed) })),
      fundingSells: bl.fundingSells
        ? bl.fundingSells.map((fs) => ({
            ...fs,
            amountUsd: fs.amountUsd * (1 - ratioUsed),
            costBasisUsd: fs.costBasisUsd === undefined ? undefined : fs.costBasisUsd * (1 - ratioUsed),
          }))
        : undefined,
      // Preserve swap information (don't scale these - they're metadata about the swap)
      swappedFromAsset: bl.swappedFromAsset,
      swappedFromQuantity: bl.swappedFromQuantity,
      swappedFromTransactionId: bl.swappedFromTransactionId,
      // Scale swappedFromBuyLots quantities and cost basis
      swappedFromBuyLots: bl.swappedFromBuyLots
        ? bl.swappedFromBuyLots.map((sbl) => ({
            ...sbl,
            quantity: sbl.quantity * (1 - ratioUsed),
            costBasisUsd: sbl.costBasisUsd * (1 - ratioUsed),
          }))
        : undefined,
    })),
  };
  return { usedMeta: used, remainingMeta: remaining };
}

function txDateISO(txDatetime: string): string {
  const asNum = Number(txDatetime);
  const d = Number.isFinite(asNum) ? new Date(asNum) : new Date(txDatetime);
  return d.toISOString().slice(0, 10);
}

function getFiatUsdAmount(tx: Transaction): { amountUsd: number; fxRateToUsd: number } {
  const fiatCurrencies = getFiatCurrencies();
  const asset = tx.toAsset.toUpperCase();
  const isFiat = fiatCurrencies.includes(asset);
  if (!isFiat) return { amountUsd: 0, fxRateToUsd: 1 };

  if (asset === 'USD') {
    const usd = tx.toQuantity;
    return { amountUsd: usd, fxRateToUsd: 1 };
  }

  // Optional explicit per-unit FX stored on the tx (e.g. EUR tx with toPriceUsd = USD per 1 EUR).
  // If present, it should be preferred over any historical fallback.
  const fxFromTx = tx.toPriceUsd && tx.toPriceUsd > 0 ? tx.toPriceUsd : null;

  const date = txDateISO(tx.datetime);
  const fx = fxFromTx ?? getHistoricalExchangeRateSyncStrict(asset, 'USD', date);
  const expectedUsd = (tx.toQuantity || 0) * fx;

  // For the new model, we can use toPriceUsd * toQuantity as the USD amount
  const explicitUsd = tx.toPriceUsd ? tx.toQuantity * tx.toPriceUsd : null;
  if (explicitUsd && explicitUsd > 0) {
    const denom = Math.max(1e-9, expectedUsd);
    const relDiff = Math.abs(explicitUsd - expectedUsd) / denom;
    if (relDiff <= 0.05) {
      const inferredFx = tx.toQuantity > 0 ? explicitUsd / tx.toQuantity : fx;
      return { amountUsd: explicitUsd, fxRateToUsd: fxFromTx ?? inferredFx };
    }
  }

  return { amountUsd: expectedUsd, fxRateToUsd: fx };
}

function getFiatRonAmount(tx: Transaction): { amountRon: number; fxRateToRon: number } {
  const fiatCurrencies = getFiatCurrencies();
  const asset = tx.toAsset.toUpperCase();
  const isFiat = fiatCurrencies.includes(asset);
  if (!isFiat) return { amountRon: 0, fxRateToRon: 1 };
  if (asset === 'RON') return { amountRon: tx.toQuantity || 0, fxRateToRon: 1 };
  const date = txDateISO(tx.datetime);
  const fx = getHistoricalExchangeRateSyncStrict(asset, 'RON', date);
  return { amountRon: (tx.toQuantity || 0) * fx, fxRateToRon: fx };
}

function contributionsToDepositTrace(contribs: Contribution[]): SourceTrace[] {
  const merged = mergeContributions(contribs);
  return merged.map((c) => {
    const originalAmount = c.fxRateToUsd > 0 ? c.amountUsd / c.fxRateToUsd : c.amountUsd;
    return {
      transactionId: c.depositTxId,
      asset: c.depositCurrency,
      quantity: originalAmount,
      costBasisUsd: c.amountUsd,
      datetime: c.depositDatetime,
      type: 'Deposit',
      pricePerUnitUsd: c.fxRateToUsd,
      originalCurrency: c.depositCurrency,
      exchangeRateAtPurchase: c.fxRateToUsd,
    };
  });
}

function buyLotsToSourceTrace(buyLots: BuyLotTrace[]): SourceTrace[] {
  // Aggregate buy lots by buy tx id to keep the UI/report readable
  // But preserve swap information for crypto-to-crypto swaps
  const map = new Map<number, { 
    asset: string; 
    datetime: string; 
    quantity: number; 
    costBasisUsd: number;
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
  }>();
  for (const bl of buyLots) {
    const prev = map.get(bl.buyTransactionId);
    if (!prev) {
      map.set(bl.buyTransactionId, {
        asset: bl.asset,
        datetime: bl.buyDatetime,
        quantity: bl.quantity,
        costBasisUsd: bl.costBasisUsd,
        swappedFromAsset: bl.swappedFromAsset,
        swappedFromQuantity: bl.swappedFromQuantity,
        swappedFromTransactionId: bl.swappedFromTransactionId,
        swappedFromBuyLots: bl.swappedFromBuyLots,
      });
    } else {
      prev.quantity += bl.quantity;
      prev.costBasisUsd += bl.costBasisUsd;
      // Preserve swap info from first occurrence
      if (!prev.swappedFromAsset && bl.swappedFromAsset) {
        prev.swappedFromAsset = bl.swappedFromAsset;
        prev.swappedFromQuantity = bl.swappedFromQuantity;
        prev.swappedFromTransactionId = bl.swappedFromTransactionId;
        prev.swappedFromBuyLots = bl.swappedFromBuyLots;
      }
      map.set(bl.buyTransactionId, prev);
    }
  }

  const result: SourceTrace[] = [];
  
  // First, add all original buy lots from swappedFromBuyLots (e.g., SOL buy before ADA swap)
  const originalBuyTxIds = new Set<number>();
  for (const v of map.values()) {
    if (v.swappedFromBuyLots) {
      for (const originalLot of v.swappedFromBuyLots) {
        if (!originalBuyTxIds.has(originalLot.buyTransactionId)) {
          originalBuyTxIds.add(originalLot.buyTransactionId);
          result.push({
            transactionId: originalLot.buyTransactionId,
            asset: originalLot.asset,
            quantity: originalLot.quantity,
            costBasisUsd: originalLot.costBasisUsd,
            datetime: originalLot.buyDatetime,
            type: 'Swap', // Original buy (e.g., USDC → SOL)
            pricePerUnitUsd: originalLot.quantity > 0 ? originalLot.costBasisUsd / originalLot.quantity : undefined,
            originalCurrency: 'USD',
            exchangeRateAtPurchase: 1.0,
          });
        }
      }
    }
  }
  
  // Then add the swap/buy transactions themselves
  for (const [buyTxId, v] of map.entries()) {
    result.push({
      transactionId: buyTxId,
      asset: v.asset,
      quantity: v.quantity,
      costBasisUsd: v.costBasisUsd,
      datetime: v.datetime,
      type: v.swappedFromAsset ? 'CryptoSwap' : 'Swap',
      pricePerUnitUsd: v.quantity > 0 ? v.costBasisUsd / v.quantity : undefined,
      originalCurrency: 'USD',
      exchangeRateAtPurchase: 1.0,
      swappedFromAsset: v.swappedFromAsset,
      swappedFromQuantity: v.swappedFromQuantity,
      swappedFromTransactionId: v.swappedFromTransactionId,
    });
  }
  
  // Sort by datetime to show chronological order
  return result.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());
}

export function calculateRomaniaTax(
  transactions: Transaction[],
  year: string,
  usdToRonRate: number = 4.5, // Default rate, should be fetched from exchange rates
  opts?: { assetStrategy?: LotStrategy; cashStrategy?: LotStrategy }
): RomaniaTaxReport {
  const assetStrategy: LotStrategy = opts?.assetStrategy ?? 'FIFO';
  const cashStrategy: LotStrategy = opts?.cashStrategy ?? 'FIFO';
  const txMillis = (tx: Transaction): number => {
    const asNum = Number(tx.datetime);
    return Number.isFinite(asNum) ? asNum : new Date(tx.datetime).getTime();
  };
  // Some exchanges record withdrawal timestamps slightly earlier than the sell/conversion that funded them
  // (often within seconds/minutes). To avoid "unfunded withdrawal" artifacts, we reorder ONLY within
  // small clusters of near-simultaneous transactions.
  const CLUSTER_WINDOW_MS = 5 * 60 * 1000;
  const typePriority = (t: Transaction['type']): number => {
    switch (t) {
      case 'Deposit':
        return 0;
      case 'Swap':
        return 1;
      case 'Withdrawal':
        return 2;
      default:
        return 9;
    }
  };
  const timeSorted = [...transactions].sort((a, b) => {
    const ta = txMillis(a);
    const tb = txMillis(b);
    if (ta !== tb) return ta - tb;
    return (a.id || 0) - (b.id || 0);
  });
  const sortedTxs: Transaction[] = [];
  let group: Transaction[] = [];
  let prevTime: number | null = null;
  const flush = () => {
    if (!group.length) return;
    group.sort((a, b) => {
      const pa = typePriority(a.type);
      const pb = typePriority(b.type);
      if (pa !== pb) return pa - pb;
      const ta = txMillis(a);
      const tb = txMillis(b);
      if (ta !== tb) return ta - tb;
      return (a.id || 0) - (b.id || 0);
    });
    sortedTxs.push(...group);
    group = [];
    prevTime = null;
  };
  for (const tx of timeSorted) {
    const t = txMillis(tx);
    if (prevTime === null) {
      group.push(tx);
      prevTime = t;
      continue;
    }
    if (t - prevTime <= CLUSTER_WINDOW_MS) {
      group.push(tx);
      prevTime = t;
      continue;
    }
    flush();
    group.push(tx);
    prevTime = t;
  }
  flush();

  const targetYear = year;
  const fiatCurrencies = getFiatCurrencies();

  const cashQueue: FIFOQueue = createFIFOQueue('CASH_USD');
  const assetQueues = new Map<string, FIFOQueue>();
  // Full sale metadata (entire sale), used to expand Sankey back through intermediate trades.
  const saleMetaById = new Map<number, NonNullable<CashMeta['sale']>>();

  const taxableEvents: TaxableEvent[] = [];
  const warnings: string[] = [];

  for (const tx of sortedTxs) {
    // For deposits, fiat currency is in fromAsset; for withdrawals, it's in toAsset
    const asset = tx.type === 'Deposit' && tx.fromAsset 
      ? tx.fromAsset.toUpperCase() 
      : tx.toAsset.toUpperCase();
    const isFiat = fiatCurrencies.includes(asset);

    if (tx.type === 'Deposit') {
      if (!isFiat || !tx.fromAsset) continue;
      // For deposits: fromAsset = fiat, fromQuantity = fiat amount
      // toAsset = stablecoin, toQuantity = stablecoin amount received
      // Use the actual stablecoin amount received (toQuantity * toPriceUsd) for the cash queue
      // This accounts for fees and exchange rate differences
      const fiatAmount = tx.fromQuantity || 0;
      if (fiatAmount <= 0) continue;
      
      let amountUsd: number;
      let fxRateToUsd: number;
      
      // If toAsset is a stablecoin, use the actual amount received
      const toAsset = tx.toAsset?.toUpperCase();
      if (toAsset && isStablecoin(toAsset)) {
        // Use the actual stablecoin amount received (stablecoins are always worth $1.0 per unit)
        // toPriceUsd might store the fiat/USD rate, but the stablecoin itself is worth $1.0
        amountUsd = (tx.toQuantity || 0) * 1.0;
        // Calculate FX rate from fiat to USD for reporting purposes
        if (asset === 'USD') {
          fxRateToUsd = 1.0;
        } else {
          const fxFromTx = tx.fromPriceUsd && tx.fromPriceUsd > 0 ? tx.fromPriceUsd : null;
          const date = txDateISO(tx.datetime);
          fxRateToUsd = fxFromTx ?? getHistoricalExchangeRateSyncStrict(asset, 'USD', date);
        }
      } else if (asset === 'USD') {
        amountUsd = fiatAmount;
        fxRateToUsd = 1.0;
      } else {
        // For EUR or other fiat, use fromPriceUsd if available, otherwise fetch historical rate
        const fxFromTx = tx.fromPriceUsd && tx.fromPriceUsd > 0 ? tx.fromPriceUsd : null;
        const date = txDateISO(tx.datetime);
        const fx = fxFromTx ?? getHistoricalExchangeRateSyncStrict(asset, 'USD', date);
        amountUsd = fiatAmount * fx;
        fxRateToUsd = fx;
      }
      
      if (amountUsd <= 0) continue;

      const contrib: Contribution = {
        depositTxId: tx.id,
        depositDatetime: tx.datetime,
        depositCurrency: asset,
        amountUsd,
        fxRateToUsd,
      };

      const meta: CashMeta = { kind: 'deposit', contributions: [contrib] };
      const updated = addToFIFO(cashQueue, tx.id, amountUsd, amountUsd, tx.datetime, `Deposit ${asset}`, meta);
      cashQueue.entries = updated.entries;
      continue;
    }

    // Swap: Stablecoin → Crypto (consume cash, acquire crypto)
    // This is NOT a taxable event in Romania, but we track for cost basis
    const isStableToCrypto = tx.type === 'Swap' && tx.fromAsset && isStablecoin(tx.fromAsset);
    if (isStableToCrypto) {
      if (isFiat) continue;
      const spendUsd = (tx.fromQuantity || 0) * (tx.fromPriceUsd || 0);
      const quantity = tx.toQuantity;
      if (!spendUsd || spendUsd <= 0 || !quantity || quantity <= 0) continue;

      const cashBal = cashQueue.entries.reduce((s, e) => s + e.quantity, 0);
      const spendActualUsd = Math.min(spendUsd, cashBal);
      if (spendActualUsd <= 0) {
        warnings.push(`Buy tx ${tx.id} (${tx.datetime}) could not be funded (cash balance is 0). Skipped.`);
        continue;
      }
      if (spendActualUsd + 1e-9 < spendUsd) {
        warnings.push(
          `Buy tx ${tx.id} (${tx.datetime}) costUsd=${spendUsd.toFixed(2)} exceeds cash balance=${cashBal.toFixed(2)}. ` +
          `Scaling buy quantity by ${(spendActualUsd / spendUsd).toFixed(6)}.`
        );
      }

      const { removed, remaining, totalCostBasis } = removeFromLots(cashQueue, spendActualUsd, { strategy: cashStrategy, splitMeta: splitCashMeta });
      cashQueue.entries = remaining.entries;

      const contributions = mergeContributions(
        removed.flatMap((e) => ((e.meta as CashMeta | undefined)?.contributions ?? []))
      );

      // Capture which sells funded this buy (this is what enables BTC -> ETH -> SOL chains)
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
            // Amount of USD cash used from that sale
            amountUsd: e.quantity,
            // Cost basis embedded in that cash portion
            costBasisUsd: e.costBasisUsd,
          });
        } else {
          prev.amountUsd += e.quantity;
          prev.costBasisUsd += e.costBasisUsd;
          fundingSellsMap.set(s.saleTransactionId, prev);
        }
      }
      const fundingSells = Array.from(fundingSellsMap.values()).filter((x) => x.amountUsd > 1e-9);

      if (!assetQueues.has(asset)) assetQueues.set(asset, createFIFOQueue(asset));
      const q = assetQueues.get(asset)!;
      const qtyRatio = spendUsd > 0 ? (spendActualUsd / spendUsd) : 1;
      const actualQty = quantity * qtyRatio;
      const meta: AssetMeta = {
        buyLots: [
          {
            buyTransactionId: tx.id,
            buyDatetime: tx.datetime,
            asset,
            quantity: actualQty,
            cashSpentUsd: spendActualUsd,
            costBasisUsd: totalCostBasis,
            contributions,
            fundingSells: fundingSells.length ? fundingSells : undefined,
            // Track that this came from a stablecoin swap
            swappedFromAsset: tx.fromAsset || undefined,
            swappedFromQuantity: tx.fromQuantity || 0,
            swappedFromTransactionId: tx.id,
          },
        ],
      };
      const updated = addToFIFO(q, tx.id, actualQty, totalCostBasis, tx.datetime, `Swap ${tx.fromAsset || '?'}→${asset}`, meta);
      assetQueues.set(asset, updated);
      continue;
    }

    // Swap: Crypto → Stablecoin (swap crypto for stablecoin)
    // Consumes from asset queue, adds to cash queue (transfers cost basis)
    // This is NOT a taxable event in Romania, but we track for cost basis
    const isCryptoToStable = tx.type === 'Swap' && 
      tx.fromAsset && !isStablecoin(tx.fromAsset) &&
      isStablecoin(tx.toAsset);
    if (isCryptoToStable) {
      if (isFiat) continue;
      const sellAsset = tx.fromAsset || '';
      if (!assetQueues.has(sellAsset)) continue;
      const quantity = tx.fromQuantity || 0;
      if (!quantity || quantity <= 0) continue;
      const proceedsUsd = (tx.toQuantity || 0) * (tx.toPriceUsd || 0);
      if (!proceedsUsd || proceedsUsd <= 0) continue;

      const q = assetQueues.get(sellAsset)!;
      const assetBal = q.entries.reduce((s, e) => s + e.quantity, 0);
      const sellActualQty = Math.min(quantity, assetBal);
      if (sellActualQty <= 0) {
        warnings.push(`Sell tx ${tx.id} (${tx.datetime}) could not be processed (no holdings for ${sellAsset}). Skipped.`);
        continue;
      }
      if (sellActualQty + 1e-9 < quantity) {
        warnings.push(
          `Sell tx ${tx.id} (${tx.datetime}) quantity=${quantity} exceeds holdings=${assetBal}. ` +
          `Scaling proceeds and quantity by ${(sellActualQty / quantity).toFixed(6)}.`
        );
      }
      const proceedsActualUsd = proceedsUsd * (sellActualQty / quantity);

      const { removed, remaining, totalCostBasis } = removeFromLots(q, sellActualQty, { strategy: assetStrategy, splitMeta: splitAssetMeta });
      assetQueues.set(sellAsset, remaining);

      const removedBuyLots = removed.flatMap((e) => ((e.meta as AssetMeta | undefined)?.buyLots ?? []));
      const contributions = mergeContributions(removedBuyLots.flatMap((bl) => bl.contributions));

      const meta: CashMeta = {
        kind: 'sale',
        contributions,
        sale: {
          saleTransactionId: tx.id,
          saleDatetime: tx.datetime,
          asset: sellAsset,
          proceedsUsd: proceedsActualUsd,
          costBasisUsd: totalCostBasis,
          buyLots: removedBuyLots.map((bl) => ({
            buyTransactionId: bl.buyTransactionId,
            buyDatetime: bl.buyDatetime,
            asset: bl.asset,
            quantity: bl.quantity,
            cashSpentUsd: bl.cashSpentUsd,
            costBasisUsd: bl.costBasisUsd,
            contributions: bl.contributions,
            fundingSells: bl.fundingSells,
            swappedFromAsset: bl.swappedFromAsset,
            swappedFromQuantity: bl.swappedFromQuantity,
            swappedFromTransactionId: bl.swappedFromTransactionId,
            swappedFromBuyLots: bl.swappedFromBuyLots,
          })),
        },
      };

      // Store full sale metadata for later deep tracing
      if (meta.sale) saleMetaById.set(tx.id, meta.sale);

      const updated = addToFIFO(cashQueue, tx.id, proceedsActualUsd, totalCostBasis, tx.datetime, `Sell ${sellAsset}`, meta);
      cashQueue.entries = updated.entries;
      continue;
    }

    // Swap: Crypto → Crypto (e.g., BTC → ETH)
    // This is NOT a taxable event in Romania
    // We consume from one asset queue and add to another, transferring cost basis
    const isCryptoToCrypto = tx.type === 'Swap' && 
      tx.fromAsset && !isStablecoin(tx.fromAsset) &&
      !isStablecoin(tx.toAsset);
    if (isCryptoToCrypto) {
      if (isFiat) continue;
      const fromAssetName = tx.fromAsset || '';
      const toAssetName = tx.toAsset;
      
      if (!assetQueues.has(fromAssetName)) {
        warnings.push(`Crypto swap tx ${tx.id} (${tx.datetime}) could not be processed (no holdings for ${fromAssetName}). Skipped.`);
        continue;
      }
      
      const fromQty = tx.fromQuantity || 0;
      const toQty = tx.toQuantity || 0;
      if (!fromQty || fromQty <= 0 || !toQty || toQty <= 0) continue;
      
      // Remove from source asset
      const fromQueue = assetQueues.get(fromAssetName)!;
      const fromBal = fromQueue.entries.reduce((s, e) => s + e.quantity, 0);
      const actualFromQty = Math.min(fromQty, fromBal);
      
      if (actualFromQty <= 0) {
        warnings.push(`Crypto swap tx ${tx.id} (${tx.datetime}) could not be processed (no holdings for ${fromAssetName}). Skipped.`);
        continue;
      }
      
      const { removed, remaining, totalCostBasis } = removeFromLots(fromQueue, actualFromQty, { strategy: assetStrategy, splitMeta: splitAssetMeta });
      assetQueues.set(fromAssetName, remaining);
      
      // Add to target asset with transferred cost basis
      const removedBuyLots = removed.flatMap((e) => ((e.meta as AssetMeta | undefined)?.buyLots ?? []));
      const contributions = mergeContributions(removedBuyLots.flatMap((bl) => bl.contributions));
      
      const toQtyRatio = fromQty > 0 ? (actualFromQty / fromQty) : 1;
      const actualToQty = toQty * toQtyRatio;
      
      if (!assetQueues.has(toAssetName)) assetQueues.set(toAssetName, createFIFOQueue(toAssetName));
      const toQueue = assetQueues.get(toAssetName)!;
      
      // Track the swap chain: preserve original buy lots from the source asset
      // NOTE: removedBuyLots already have the correct quantities and cost basis from removeFromLots
      // We should NOT scale them by toQtyRatio - that ratio is only for scaling the TO quantity
      const swappedFromBuyLots = removedBuyLots.map(bl => ({
        buyTransactionId: bl.buyTransactionId,
        buyDatetime: bl.buyDatetime,
        asset: bl.asset,
        quantity: bl.quantity, // Use the actual removed quantity (already correct from removeFromLots)
        costBasisUsd: bl.costBasisUsd, // Use the actual removed cost basis (already correct from removeFromLots)
      }));
      
      const meta: AssetMeta = {
        buyLots: [
          {
            buyTransactionId: tx.id,
            buyDatetime: tx.datetime,
            asset: toAssetName,
            quantity: actualToQty,
            cashSpentUsd: undefined, // No cash involved in crypto-to-crypto
            costBasisUsd: totalCostBasis, // Transfer cost basis from source asset
            contributions,
            fundingSells: undefined,
            // Track the swap chain
            swappedFromAsset: fromAssetName,
            swappedFromQuantity: actualFromQty,
            swappedFromTransactionId: tx.id,
            swappedFromBuyLots: swappedFromBuyLots.length > 0 ? swappedFromBuyLots : undefined,
          },
        ],
      };
      
      const updatedTo = addToFIFO(toQueue, tx.id, actualToQty, totalCostBasis, tx.datetime, `Swap ${fromAssetName} to ${toAssetName}`, meta);
      assetQueues.set(toAssetName, updatedTo);
      continue;
    }

    if (tx.type === 'Withdrawal') {
      if (!isFiat) continue;
      const { amountUsd, fxRateToUsd } = getFiatUsdAmount(tx);
      if (!amountUsd || amountUsd <= 0) continue;
      const { amountRon, fxRateToRon } = getFiatRonAmount(tx);

      const cashBal = cashQueue.entries.reduce((s, e) => s + e.quantity, 0);
      
      // Handle withdrawals even if cash balance is 0 (record as taxable event with 0 cost basis)
      let withdrawActualUsd: number;
      let withdrawScale: number;
      let withdrawActualRon: number;
      let withdrawActualOriginal: number;
      let totalCostBasis: number;
      let removed: ReturnType<typeof removeFromLots>['removed'];
      let remaining: ReturnType<typeof removeFromLots>['remaining'];
      
      if (cashBal <= 0) {
        // No cash available - still record as taxable event but with 0 cost basis
        warnings.push(
          `Withdrawal tx ${tx.id} (${tx.datetime}) amountUsd=${amountUsd.toFixed(2)} has no tracked cash balance. ` +
          `This withdrawal will be recorded with 0 cost basis (full amount is taxable gain).`
        );
        withdrawActualUsd = amountUsd;
        withdrawScale = 1.0;
        withdrawActualRon = amountRon;
        withdrawActualOriginal = tx.toQuantity || 0;
        totalCostBasis = 0;
        removed = [];
        remaining = createFIFOQueue('CASH_USD');
      } else {
        withdrawActualUsd = Math.min(amountUsd, cashBal);
        withdrawScale = amountUsd > 0 ? (withdrawActualUsd / amountUsd) : 0;
        withdrawActualRon = amountRon * withdrawScale;
        withdrawActualOriginal = (tx.toQuantity || 0) * withdrawScale;
        if (withdrawActualUsd + 1e-9 < amountUsd) {
          warnings.push(
            `Withdrawal tx ${tx.id} (${tx.datetime}) amountUsd=${amountUsd.toFixed(2)} exceeds cash balance=${cashBal.toFixed(2)}. ` +
            `Treating only ${withdrawActualUsd.toFixed(2)} as sourced from tracked cash lots.`
          );
        }
        const result = removeFromLots(cashQueue, withdrawActualUsd, { strategy: cashStrategy, splitMeta: splitCashMeta });
        removed = result.removed;
        remaining = result.remaining;
        totalCostBasis = result.totalCostBasis;
        cashQueue.entries = remaining.entries;
      }

      const contributions = removed.length > 0 
        ? mergeContributions(
            removed.flatMap((e) => ((e.meta as CashMeta | undefined)?.contributions ?? []))
          )
        : [];
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
            // merge deposit traces by folding back to contributions, then back again
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

            if (bl.fundingSells && bl.fundingSells.length) {
              const m = new Map<number, { saleTransactionId: number; saleDatetime: string; asset: string; amountUsd: number; costBasisUsd?: number }>();
              (existing.fundingSells || []).forEach((x: { saleTransactionId: number; saleDatetime: string; asset: string; amountUsd: number; costBasisUsd?: number }) =>
                m.set(x.saleTransactionId, { ...x })
              );
              bl.fundingSells.forEach((x: { saleTransactionId: number; saleDatetime: string; asset: string; amountUsd: number; costBasisUsd?: number }) => {
                const prev = m.get(x.saleTransactionId);
                if (!prev) m.set(x.saleTransactionId, { ...x });
                else {
                  prev.amountUsd += x.amountUsd;
                  if (x.costBasisUsd !== undefined) prev.costBasisUsd = (prev.costBasisUsd || 0) + x.costBasisUsd;
                  m.set(x.saleTransactionId, prev);
                }
              });
              existing.fundingSells = Array.from(m.values());
            }
            
            // Preserve swap information if not already set (should be the same for same buyTransactionId, but preserve if missing)
            if (!existing.swappedFromAsset && bl.swappedFromAsset) {
              existing.swappedFromAsset = bl.swappedFromAsset;
              existing.swappedFromQuantity = bl.swappedFromQuantity;
              existing.swappedFromTransactionId = bl.swappedFromTransactionId;
              existing.swappedFromBuyLots = bl.swappedFromBuyLots;
            } else if (existing.swappedFromBuyLots && bl.swappedFromBuyLots) {
              // Merge swappedFromBuyLots if both exist (shouldn't happen for same buyTransactionId, but handle it)
              const mergedSwappedFromBuyLots = new Map<number, typeof existing.swappedFromBuyLots[0]>();
              existing.swappedFromBuyLots.forEach((sbl) => mergedSwappedFromBuyLots.set(sbl.buyTransactionId, { ...sbl }));
              bl.swappedFromBuyLots.forEach((sbl) => {
                const prev = mergedSwappedFromBuyLots.get(sbl.buyTransactionId);
                if (!prev) {
                  mergedSwappedFromBuyLots.set(sbl.buyTransactionId, { ...sbl });
                } else {
                  prev.quantity += sbl.quantity;
                  prev.costBasisUsd += sbl.costBasisUsd;
                }
              });
              existing.swappedFromBuyLots = Array.from(mergedSwappedFromBuyLots.values());
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

          // For the additional portion of this sale now included, request upstream funding sells from its buy lots
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

        // Materialize deep traces using the final wantedBySale amounts (capped) and proportional scaling.
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
            // Preserve swap information (don't scale these - they're metadata about the swap)
            swappedFromAsset: bl.swappedFromAsset,
            swappedFromQuantity: bl.swappedFromQuantity,
            swappedFromTransactionId: bl.swappedFromTransactionId,
            // Scale swappedFromBuyLots quantities and cost basis
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

      // Primary trace: buy lots across all sells contributing to this withdrawal (much smaller than deposit list)
      const allBuyLots = saleTrace.flatMap((s) => s.buyLots);
      const sourceTrace: SourceTrace[] = buyLotsToSourceTrace(allBuyLots);

      const txYear = new Date(tx.datetime).getFullYear().toString();
      if (txYear === targetYear) {
        const usdRonAtWithdrawal = getHistoricalExchangeRateSyncStrict('USD', 'RON', txDateISO(tx.datetime));
        const costBasisRon = totalCostBasis * usdRonAtWithdrawal;
        taxableEvents.push({
          transactionId: tx.id,
          datetime: tx.datetime,
          fiatCurrency: asset,
          fiatAmountOriginal: withdrawActualOriginal,
          fxFiatToUsd: fxRateToUsd,
          fxFiatToRon: fxRateToRon,
          fxUsdToRon: usdRonAtWithdrawal,
          fiatAmountUsd: withdrawActualUsd,
          // Convert directly from withdrawal currency -> RON (EUR->RON, USD->RON, etc), not via USD.
          fiatAmountRon: withdrawActualRon,
          costBasisUsd: totalCostBasis,
          // Cost basis is tracked in USD internally, so convert USD->RON at the withdrawal date.
          costBasisRon,
          gainLossUsd: withdrawActualUsd - totalCostBasis,
          gainLossRon: withdrawActualRon - costBasisRon,
          sourceTrace,
          saleTrace: saleTrace.length ? saleTrace : undefined,
          saleTraceDeep: saleTraceDeep.length ? saleTraceDeep : undefined,
          depositTrace: depositTrace.length ? depositTrace : undefined,
        });
      }
      continue;
    }
  }

  // Calculate totals (all in USD first, then convert to RON)
  // IMPORTANT: Cost basis only includes assets that were actually withdrawn (taxable events)
  // Cost basis represents the original purchase price, not the sale price
  // If cost basis > withdrawals, it means assets were sold at a loss
  const totalWithdrawalsUsd = taxableEvents.reduce((sum, e) => sum + e.fiatAmountUsd, 0);
  const totalWithdrawalsRon = taxableEvents.reduce((sum, e) => sum + e.fiatAmountRon, 0);
  const totalCostBasisUsd = taxableEvents.reduce((sum, e) => sum + e.costBasisUsd, 0);
  const totalCostBasisRon = taxableEvents.reduce((sum, e) => sum + e.costBasisRon, 0);
  const totalGainLossUsd = taxableEvents.reduce((sum, e) => sum + e.gainLossUsd, 0);
  const totalGainLossRon = taxableEvents.reduce((sum, e) => sum + e.gainLossRon, 0);
  
  // Validation: Ensure cost basis only comes from actual withdrawals
  // Each taxable event's cost basis should be proportional to what was withdrawn
  // Note: Cost basis can be higher than withdrawals if assets were sold at a loss
  
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
    warnings: warnings.length ? warnings : undefined,
  };
}


