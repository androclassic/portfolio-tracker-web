/**
 * Romanian Tax Calculation (FIFO)
 *
 * DB semantics (confirmed from SQLite):
 * - `Deposit`: fiat deposited to the exchange (usually EUR) with `costUsd` set as USD equivalent.
 * - `Buy`: buying a crypto asset with `costUsd` set (USD spent).
 * - `Sell`: selling a crypto asset with `proceedsUsd` set (USD received).
 * - `Withdrawal`: fiat withdrawn from the exchange (usually USD) with `proceedsUsd` sometimes set.
 *
 * We model this like an accountant:
 * - Maintain a FIFO **cash queue** in USD-equivalent.
 *   - Deposits add principal cash lots (cost basis == amount).
 *   - Sells add cash lots whose cost basis comes from the crypto lots sold (basis transfer).
 *   - Buys consume cash lots (transferring their embedded cost basis into the acquired crypto lots).
 *   - Withdrawals consume cash lots; the consumed cost basis is used for gain/loss.
 * - Maintain FIFO **asset queues** for each crypto/stablecoin asset.
 *
 * Taxable events (per your request): fiat withdrawals.
 * All calculations are done in USD and converted to RON only at the end.
 */

import type { Transaction } from '@/lib/types';
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
  type: 'Deposit' | 'Buy';
  pricePerUnitUsd?: number;
  originalCurrency?: string;
  exchangeRateAtPurchase?: number;
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
  const asset = tx.asset.toUpperCase();
  const isFiat = fiatCurrencies.includes(asset);
  if (!isFiat) return { amountUsd: 0, fxRateToUsd: 1 };

  if (asset === 'USD') {
    const usd = tx.proceedsUsd ?? tx.costUsd ?? tx.quantity;
    return { amountUsd: usd, fxRateToUsd: 1 };
  }

  // Optional explicit per-unit FX stored on the tx (e.g. EUR tx with priceUsd = USD per 1 EUR).
  // If present, it should be preferred over any historical fallback.
  const fxFromTx = tx.priceUsd && tx.priceUsd > 0 ? tx.priceUsd : null;

  const date = txDateISO(tx.datetime);
  const fx = fxFromTx ?? getHistoricalExchangeRateSyncStrict(asset, 'USD', date);
  const expectedUsd = (tx.quantity || 0) * fx;

  // Some imports incorrectly populate costUsd/proceedsUsd for fiat rows (fees, partials, etc).
  // Only trust explicit USD if it matches quantity*FX within a small tolerance.
  const explicitUsd = tx.proceedsUsd ?? tx.costUsd;
  if (explicitUsd && explicitUsd > 0) {
    const denom = Math.max(1e-9, expectedUsd);
    const relDiff = Math.abs(explicitUsd - expectedUsd) / denom;
    if (relDiff <= 0.05) {
      const inferredFx = tx.quantity > 0 ? explicitUsd / tx.quantity : fx;
      return { amountUsd: explicitUsd, fxRateToUsd: fxFromTx ?? inferredFx };
    }
  }

  return { amountUsd: expectedUsd, fxRateToUsd: fx };
}

function getFiatRonAmount(tx: Transaction): { amountRon: number; fxRateToRon: number } {
  const fiatCurrencies = getFiatCurrencies();
  const asset = tx.asset.toUpperCase();
  const isFiat = fiatCurrencies.includes(asset);
  if (!isFiat) return { amountRon: 0, fxRateToRon: 1 };
  if (asset === 'RON') return { amountRon: tx.quantity || 0, fxRateToRon: 1 };
  const date = txDateISO(tx.datetime);
  const fx = getHistoricalExchangeRateSyncStrict(asset, 'RON', date);
  return { amountRon: (tx.quantity || 0) * fx, fxRateToRon: fx };
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
  const map = new Map<number, { asset: string; datetime: string; quantity: number; costBasisUsd: number }>();
  for (const bl of buyLots) {
    const prev = map.get(bl.buyTransactionId);
    if (!prev) {
      map.set(bl.buyTransactionId, {
        asset: bl.asset,
        datetime: bl.buyDatetime,
        quantity: bl.quantity,
        costBasisUsd: bl.costBasisUsd,
      });
    } else {
      prev.quantity += bl.quantity;
      prev.costBasisUsd += bl.costBasisUsd;
      map.set(bl.buyTransactionId, prev);
    }
  }

  return Array.from(map.entries()).map(([buyTxId, v]) => ({
    transactionId: buyTxId,
    asset: v.asset,
    quantity: v.quantity,
    costBasisUsd: v.costBasisUsd,
    datetime: v.datetime,
    type: 'Buy',
    pricePerUnitUsd: v.quantity > 0 ? v.costBasisUsd / v.quantity : undefined,
    originalCurrency: 'USD',
    exchangeRateAtPurchase: 1.0,
  }));
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
      case 'Sell':
        return 1;
      case 'Buy':
        return 2;
      case 'Withdrawal':
        return 3;
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
    const asset = tx.asset.toUpperCase();
    const isFiat = fiatCurrencies.includes(asset);

    if (tx.type === 'Deposit') {
      if (!isFiat) continue;
      const { amountUsd, fxRateToUsd } = getFiatUsdAmount(tx);
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

    if (tx.type === 'Buy') {
      if (isFiat) continue;
      const spendUsd = tx.costUsd ?? ((tx.priceUsd || 0) * tx.quantity);
      if (!spendUsd || spendUsd <= 0 || !tx.quantity || tx.quantity <= 0) continue;

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
      const actualQty = tx.quantity * qtyRatio;
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
          },
        ],
      };
      const updated = addToFIFO(q, tx.id, actualQty, totalCostBasis, tx.datetime, `Buy ${asset}`, meta);
      assetQueues.set(asset, updated);
      continue;
    }

    if (tx.type === 'Sell') {
      if (isFiat) continue;
      if (!assetQueues.has(asset)) continue;
      if (!tx.quantity || tx.quantity <= 0) continue;
      const proceedsUsd = tx.proceedsUsd ?? ((tx.priceUsd || 0) * tx.quantity);
      if (!proceedsUsd || proceedsUsd <= 0) continue;

      const q = assetQueues.get(asset)!;
      const assetBal = q.entries.reduce((s, e) => s + e.quantity, 0);
      const sellActualQty = Math.min(tx.quantity, assetBal);
      if (sellActualQty <= 0) {
        warnings.push(`Sell tx ${tx.id} (${tx.datetime}) could not be processed (no holdings for ${asset}). Skipped.`);
        continue;
      }
      if (sellActualQty + 1e-9 < tx.quantity) {
        warnings.push(
          `Sell tx ${tx.id} (${tx.datetime}) quantity=${tx.quantity} exceeds holdings=${assetBal}. ` +
          `Scaling proceeds and quantity by ${(sellActualQty / tx.quantity).toFixed(6)}.`
        );
      }
      const proceedsActualUsd = proceedsUsd * (sellActualQty / tx.quantity);

      const { removed, remaining, totalCostBasis } = removeFromLots(q, sellActualQty, { strategy: assetStrategy, splitMeta: splitAssetMeta });
      assetQueues.set(asset, remaining);

      const removedBuyLots = removed.flatMap((e) => ((e.meta as AssetMeta | undefined)?.buyLots ?? []));
      const contributions = mergeContributions(removedBuyLots.flatMap((bl) => bl.contributions));

      const meta: CashMeta = {
        kind: 'sale',
        contributions,
        sale: {
          saleTransactionId: tx.id,
          saleDatetime: tx.datetime,
          asset,
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
          })),
        },
      };

      // Store full sale metadata for later deep tracing
      if (meta.sale) saleMetaById.set(tx.id, meta.sale);

      const updated = addToFIFO(cashQueue, tx.id, proceedsActualUsd, totalCostBasis, tx.datetime, `Sell ${asset}`, meta);
      cashQueue.entries = updated.entries;
      continue;
    }

    if (tx.type === 'Withdrawal') {
      if (!isFiat) continue;
      const { amountUsd, fxRateToUsd } = getFiatUsdAmount(tx);
      if (!amountUsd || amountUsd <= 0) continue;
      const { amountRon, fxRateToRon } = getFiatRonAmount(tx);

      const cashBal = cashQueue.entries.reduce((s, e) => s + e.quantity, 0);
      if (cashBal <= 0) continue;

      const withdrawActualUsd = Math.min(amountUsd, cashBal);
      const withdrawScale = amountUsd > 0 ? (withdrawActualUsd / amountUsd) : 0;
      const withdrawActualRon = amountRon * withdrawScale;
      const withdrawActualOriginal = (tx.quantity || 0) * withdrawScale;
      if (withdrawActualUsd + 1e-9 < amountUsd) {
        warnings.push(
          `Withdrawal tx ${tx.id} (${tx.datetime}) amountUsd=${amountUsd.toFixed(2)} exceeds cash balance=${cashBal.toFixed(2)}. ` +
          `Treating only ${withdrawActualUsd.toFixed(2)} as sourced from tracked cash lots.`
        );
      }
      const { removed, remaining, totalCostBasis } = removeFromLots(cashQueue, withdrawActualUsd, { strategy: cashStrategy, splitMeta: splitCashMeta });
      cashQueue.entries = remaining.entries;

      const contributions = mergeContributions(
        removed.flatMap((e) => ((e.meta as CashMeta | undefined)?.contributions ?? []))
      );
      const depositTrace: SourceTrace[] = contributionsToDepositTrace(contributions);

      // Build sell->buy traceability for "how you made the money"
      const saleEntries = removed
        .map((e) => (e.meta as CashMeta | undefined)?.sale)
        .filter((s): s is NonNullable<CashMeta['sale']> => Boolean(s));

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


