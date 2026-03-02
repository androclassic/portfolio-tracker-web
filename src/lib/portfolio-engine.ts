import { isStablecoin as isStablecoinAsset } from '@/lib/assets';

const MIN_QUANTITY = 0.0001;

export interface PortfolioTransactionLike {
  type: string;
  datetime?: string | Date;
  fromAsset?: string | null;
  fromQuantity?: number | null;
  fromPriceUsd?: number | null;
  toAsset?: string | null;
  toQuantity?: number | null;
  toPriceUsd?: number | null;
}

export interface HistoricalPricePointLike {
  date: string;
  asset: string;
  price_usd: number;
}

export interface AssetPosition {
  quantity: number;
  costBasis: number;
  realizedPnl: number;
}

export interface ValuedAssetPosition extends AssetPosition {
  asset: string;
  currentPrice: number;
  currentValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  totalPnl: number;
  totalPnlPercent: number;
}

export interface PortfolioValuationSummary {
  totalValue: number;
  totalCost: number;
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;
  totalNetPnl: number;
  totalUnrealizedPnlPercent: number;
  totalNetPnlPercent: number;
}

function normalizeAsset(value: string | null | undefined): string | null {
  const normalized = (value || '').trim().toUpperCase();
  return normalized || null;
}

function toAbsNumber(value: number | null | undefined): number {
  const num = Number(value);
  return Number.isFinite(num) ? Math.abs(num) : 0;
}

function toNonNegativeNumber(value: number | null | undefined): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function getOrCreatePosition(
  positions: Record<string, AssetPosition>,
  asset: string,
): AssetPosition {
  if (!positions[asset]) {
    positions[asset] = { quantity: 0, costBasis: 0, realizedPnl: 0 };
  }
  return positions[asset];
}

function addPosition(
  positions: Record<string, AssetPosition>,
  asset: string,
  quantity: number,
  costBasis: number,
) {
  const position = getOrCreatePosition(positions, asset);
  position.quantity += quantity;
  position.costBasis += costBasis;
}

function removePosition(
  positions: Record<string, AssetPosition>,
  asset: string,
  quantity: number,
): number {
  const position = getOrCreatePosition(positions, asset);
  if (position.quantity <= 0 || quantity <= 0) return 0;

  const qtyToRemove = Math.min(quantity, position.quantity);
  const ratio = qtyToRemove / position.quantity;
  const removedCostBasis = position.costBasis * ratio;

  position.quantity -= qtyToRemove;
  position.costBasis -= removedCostBasis;

  if (position.quantity < MIN_QUANTITY) {
    position.quantity = 0;
    if (Math.abs(position.costBasis) < MIN_QUANTITY) {
      position.costBasis = 0;
    }
  }

  return removedCostBasis;
}

/**
 * Apply one transaction to net holdings (quantity-only) using canonical semantics:
 * - Swap: subtract `from`, add `to`
 * - Deposit: add `to` only
 * - Withdrawal: subtract `from` only
 */
export function applyTransactionToNetHoldings(
  holdings: Record<string, number>,
  tx: PortfolioTransactionLike,
): void {
  const fromAsset = normalizeAsset(tx.fromAsset);
  const toAsset = normalizeAsset(tx.toAsset);
  const fromQuantity = toAbsNumber(tx.fromQuantity);
  const toQuantity = toAbsNumber(tx.toQuantity);

  if (tx.type === 'Swap') {
    if (fromAsset && fromQuantity > 0) {
      holdings[fromAsset] = (holdings[fromAsset] || 0) - fromQuantity;
    }
    if (toAsset && toQuantity > 0) {
      holdings[toAsset] = (holdings[toAsset] || 0) + toQuantity;
    }
    return;
  }

  if (tx.type === 'Deposit') {
    if (toAsset && toQuantity > 0) {
      holdings[toAsset] = (holdings[toAsset] || 0) + toQuantity;
    }
    return;
  }

  if (tx.type === 'Withdrawal') {
    if (fromAsset && fromQuantity > 0) {
      holdings[fromAsset] = (holdings[fromAsset] || 0) - fromQuantity;
    }
  }
}

export function computeNetHoldings(
  transactions: PortfolioTransactionLike[],
): Record<string, number> {
  const holdings: Record<string, number> = {};
  for (const tx of transactions) {
    applyTransactionToNetHoldings(holdings, tx);
  }
  return holdings;
}

/**
 * Build per-asset quantity + cost-basis + realized-PnL positions.
 */
export function buildAssetPositions(
  transactions: PortfolioTransactionLike[],
): Record<string, AssetPosition> {
  const positions: Record<string, AssetPosition> = {};

  for (const tx of transactions) {
    const fromAsset = normalizeAsset(tx.fromAsset);
    const toAsset = normalizeAsset(tx.toAsset);
    const fromQuantity = toAbsNumber(tx.fromQuantity);
    const toQuantity = toAbsNumber(tx.toQuantity);
    const fromValueUsd = fromQuantity * toNonNegativeNumber(tx.fromPriceUsd);
    const toValueUsd = toQuantity * toNonNegativeNumber(tx.toPriceUsd);

    if (tx.type === 'Swap') {
      let removedCostBasis = 0;

      if (fromAsset && fromQuantity > 0) {
        removedCostBasis = removePosition(positions, fromAsset, fromQuantity);
        const proceedsUsd =
          toValueUsd > 0
            ? toValueUsd
            : (fromValueUsd > 0 ? fromValueUsd : removedCostBasis);
        const fromPosition = getOrCreatePosition(positions, fromAsset);
        fromPosition.realizedPnl += proceedsUsd - removedCostBasis;
      }

      if (toAsset && toQuantity > 0) {
        const addCostBasis =
          toValueUsd > 0
            ? toValueUsd
            : (fromValueUsd > 0 ? fromValueUsd : removedCostBasis);
        addPosition(positions, toAsset, toQuantity, addCostBasis);
      }
      continue;
    }

    if (tx.type === 'Deposit') {
      if (toAsset && toQuantity > 0) {
        const addCostBasis =
          toValueUsd > 0 ? toValueUsd : (fromValueUsd > 0 ? fromValueUsd : 0);
        addPosition(positions, toAsset, toQuantity, addCostBasis);
      }
      continue;
    }

    if (tx.type === 'Withdrawal') {
      if (fromAsset && fromQuantity > 0) {
        const removedCostBasis = removePosition(positions, fromAsset, fromQuantity);
        const proceedsUsd =
          toValueUsd > 0
            ? toValueUsd
            : (fromValueUsd > 0 ? fromValueUsd : removedCostBasis);
        const fromPosition = getOrCreatePosition(positions, fromAsset);
        fromPosition.realizedPnl += proceedsUsd - removedCostBasis;
      }
    }
  }

  return positions;
}

export function valueAssetPositions(
  positions: Record<string, AssetPosition>,
  currentPrices: Record<string, number>,
  options?: {
    minQuantity?: number;
    isStablecoin?: (asset: string) => boolean;
  },
): { holdings: ValuedAssetPosition[]; summary: PortfolioValuationSummary } {
  const minQuantity = options?.minQuantity ?? MIN_QUANTITY;
  const isStablecoin = options?.isStablecoin ?? isStablecoinAsset;

  const holdings: ValuedAssetPosition[] = [];
  let totalValue = 0;
  let totalCost = 0;
  let totalUnrealizedPnl = 0;
  let totalRealizedPnl = 0;

  for (const [asset, position] of Object.entries(positions)) {
    totalRealizedPnl += position.realizedPnl;

    if (position.quantity <= minQuantity) continue;

    const currentPrice = isStablecoin(asset) ? 1 : (Number(currentPrices[asset]) || 0);
    const currentValue = position.quantity * currentPrice;
    const unrealizedPnl = currentValue - position.costBasis;
    const totalPnl = unrealizedPnl + position.realizedPnl;

    holdings.push({
      asset,
      quantity: position.quantity,
      costBasis: position.costBasis,
      realizedPnl: position.realizedPnl,
      currentPrice,
      currentValue,
      unrealizedPnl,
      unrealizedPnlPercent:
        position.costBasis > 0 ? (unrealizedPnl / position.costBasis) * 100 : 0,
      totalPnl,
      totalPnlPercent:
        position.costBasis > 0 ? (totalPnl / position.costBasis) * 100 : 0,
    });

    totalValue += currentValue;
    totalCost += position.costBasis;
    totalUnrealizedPnl += unrealizedPnl;
  }

  const totalNetPnl = totalUnrealizedPnl + totalRealizedPnl;
  const summary: PortfolioValuationSummary = {
    totalValue,
    totalCost,
    totalUnrealizedPnl,
    totalRealizedPnl,
    totalNetPnl,
    totalUnrealizedPnlPercent: totalCost > 0 ? (totalUnrealizedPnl / totalCost) * 100 : 0,
    totalNetPnlPercent: totalCost > 0 ? (totalNetPnl / totalCost) * 100 : 0,
  };

  holdings.sort((a, b) => b.currentValue - a.currentValue);

  return { holdings, summary };
}

interface AssetPnlEvent {
  type: 'Buy' | 'Sell';
  units: number;
  unitPrice: number;
}

export function buildAssetSwapPnlSeries(
  transactions: PortfolioTransactionLike[],
  historicalPrices: HistoricalPricePointLike[],
  assetSymbol: string,
): { dates: string[]; realized: number[]; unrealized: number[] } {
  const asset = assetSymbol.toUpperCase();
  if (!asset || isStablecoinAsset(asset)) {
    return { dates: [], realized: [], unrealized: [] };
  }

  const dates = Array.from(new Set(historicalPrices.map((p) => p.date))).sort();
  if (dates.length === 0) {
    return { dates: [], realized: [], unrealized: [] };
  }

  const priceMap = new Map<string, number>();
  for (const p of historicalPrices) {
    priceMap.set(`${p.date}|${p.asset.toUpperCase()}`, p.price_usd);
  }

  const byDate = new Map<string, AssetPnlEvent[]>();
  for (const tx of transactions) {
    if (tx.type !== 'Swap') continue;

    const txDate = getTransactionDateKey(tx);
    if (!txDate) continue;

    const existing = byDate.get(txDate) || [];
    const toAsset = normalizeAsset(tx.toAsset);
    const fromAsset = normalizeAsset(tx.fromAsset);

    if (toAsset === asset) {
      const units = toAbsNumber(tx.toQuantity);
      if (units > 0) {
        const unitPrice =
          toNonNegativeNumber(tx.toPriceUsd) || (priceMap.get(`${txDate}|${asset}`) || 0);
        existing.push({ type: 'Buy', units, unitPrice });
      }
    } else if (fromAsset === asset) {
      const units = toAbsNumber(tx.fromQuantity);
      if (units > 0) {
        const unitPrice =
          toNonNegativeNumber(tx.fromPriceUsd) || (priceMap.get(`${txDate}|${asset}`) || 0);
        existing.push({ type: 'Sell', units, unitPrice });
      }
    }

    if (existing.length > 0) {
      byDate.set(txDate, existing);
    }
  }

  const realized: number[] = [];
  const unrealized: number[] = [];
  let heldUnits = 0;
  let heldCost = 0;
  let realizedCum = 0;

  for (const d of dates) {
    const todays = byDate.get(d) || [];
    for (const event of todays) {
      if (event.type === 'Buy') {
        heldUnits += event.units;
        heldCost += event.units * event.unitPrice;
      } else {
        const qty = Math.min(event.units, heldUnits);
        const avgCost = heldUnits > 0 ? heldCost / heldUnits : 0;
        const profit = (event.unitPrice - avgCost) * qty;
        realizedCum += profit;
        heldUnits -= qty;
        heldCost -= avgCost * qty;
      }
    }

    const currentPrice = priceMap.get(`${d}|${asset}`) || 0;
    const avgCost = heldUnits > 0 ? heldCost / heldUnits : 0;
    const unrealizedNow = (currentPrice - avgCost) * heldUnits;

    realized.push(realizedCum);
    unrealized.push(unrealizedNow);
  }

  return { dates, realized, unrealized };
}

function getTransactionDateKey(tx: PortfolioTransactionLike): string | null {
  if (!tx.datetime) return null;
  const dt =
    tx.datetime instanceof Date
      ? tx.datetime
      : new Date(String(tx.datetime));
  if (!Number.isFinite(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}
