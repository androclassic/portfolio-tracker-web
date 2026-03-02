import { isStablecoin as isStablecoinAsset } from '@/lib/assets';

const MIN_QUANTITY = 0.0001;

export interface PortfolioTransactionLike {
  type: string;
  fromAsset?: string | null;
  fromQuantity?: number | null;
  fromPriceUsd?: number | null;
  toAsset?: string | null;
  toQuantity?: number | null;
  toPriceUsd?: number | null;
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
