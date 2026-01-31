import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentPrices, getHistoricalPrices } from '@/lib/prices/service';
import { getAssetColor, isStablecoin } from '@/lib/assets';
import crypto from 'crypto';

/**
 * Ticker API - Returns portfolio data for external display devices (e-ink ticker, etc.)
 *
 * Authentication: API Key via X-API-Key header
 * Generate API keys from your account settings page
 *
 * Query params:
 *   - portfolioId: number (default: 1)
 *
 * Returns:
 *   - holdings: array of { asset, quantity, currentPrice, currentValue, costBasis, pnl, pnlPercent, color }
 *   - allocation: array of { asset, value, percentage, color }
 *   - pnlData: array of { asset, pnl, color } sorted by absolute P&L
 *   - summary: { totalValue, totalCost, totalPnl, totalPnlPercent, btcPrice }
 */

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function validateApiKey(apiKey: string): Promise<{ valid: boolean; userId?: string }> {
  if (!apiKey) {
    return { valid: false };
  }

  const hashedKey = hashApiKey(apiKey);

  // Find the API key in database
  const keyRecord = await prisma.apiKey.findFirst({
    where: {
      key: hashedKey,
      revokedAt: null, // Not revoked
      OR: [
        { expiresAt: null }, // No expiration
        { expiresAt: { gt: new Date() } }, // Not expired
      ],
    },
    select: {
      id: true,
      userId: true,
    },
  });

  if (!keyRecord) {
    return { valid: false };
  }

  // Update last used timestamp (fire and forget)
  prisma.apiKey.update({
    where: { id: keyRecord.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {}); // Ignore errors

  return { valid: true, userId: keyRecord.userId };
}

export async function GET(req: NextRequest) {
  // Check API key
  const apiKey = req.headers.get('x-api-key');

  if (!apiKey) {
    return NextResponse.json(
      { error: 'Unauthorized. Missing API key. Generate one from your account settings.' },
      { status: 401 }
    );
  }

  // Validate API key and get user ID
  const { valid, userId } = await validateApiKey(apiKey);

  if (!valid || !userId) {
    return NextResponse.json(
      { error: 'Unauthorized. Invalid or expired API key.' },
      { status: 401 }
    );
  }

  // Get query params
  const url = new URL(req.url);
  const portfolioId = Number(url.searchParams.get('portfolioId') || '1');

  // Fetch portfolio and verify ownership (userId comes from the validated API key)
  const portfolio = await prisma.portfolio.findFirst({
    where: { id: portfolioId, userId },
  });

  if (!portfolio) {
    return NextResponse.json(
      { error: 'Portfolio not found' },
      { status: 404 }
    );
  }

  // Fetch all transactions for this portfolio
  const transactions = await prisma.transaction.findMany({
    where: { portfolioId },
    orderBy: { datetime: 'asc' },
  });

  if (transactions.length === 0) {
    return NextResponse.json({
      holdings: [],
      allocation: [],
      pnlData: [],
      summary: {
        totalValue: 0,
        totalCost: 0,
        totalPnl: 0,
        totalPnlPercent: 0,
        btcPrice: 0,
      },
    });
  }

  // Calculate holdings from transactions using new schema
  // New schema uses: type (Deposit/Withdrawal/Swap), fromAsset/fromQuantity/fromPriceUsd, toAsset/toQuantity/toPriceUsd
  const holdingsMap: Record<string, { quantity: number; costBasis: number }> = {};

  for (const tx of transactions) {
    // Handle "to" side (receiving assets)
    if (tx.toAsset && tx.toQuantity) {
      const asset = tx.toAsset.toUpperCase();
      if (!holdingsMap[asset]) {
        holdingsMap[asset] = { quantity: 0, costBasis: 0 };
      }

      const quantity = Number(tx.toQuantity) || 0;
      // Cost basis: use toPriceUsd * toQuantity, or for swaps use fromPriceUsd * fromQuantity
      let costUsd = 0;
      if (tx.toPriceUsd) {
        costUsd = quantity * Number(tx.toPriceUsd);
      } else if (tx.fromPriceUsd && tx.fromQuantity) {
        // For swaps without toPriceUsd, derive from source side
        costUsd = Number(tx.fromQuantity) * Number(tx.fromPriceUsd);
      }

      holdingsMap[asset].quantity += quantity;
      holdingsMap[asset].costBasis += costUsd;
    }

    // Handle "from" side (sending assets) - reduces holdings
    if (tx.fromAsset && tx.fromQuantity) {
      const asset = tx.fromAsset.toUpperCase();
      if (!holdingsMap[asset]) {
        holdingsMap[asset] = { quantity: 0, costBasis: 0 };
      }

      const quantity = Number(tx.fromQuantity) || 0;

      // Proportionally reduce cost basis
      if (holdingsMap[asset].quantity > 0) {
        const ratio = Math.min(quantity / holdingsMap[asset].quantity, 1);
        holdingsMap[asset].costBasis -= holdingsMap[asset].costBasis * ratio;
      }
      holdingsMap[asset].quantity -= quantity;
    }
  }

  // Filter out assets with zero or negative holdings
  const assetsWithHoldings = Object.entries(holdingsMap)
    .filter(([_, data]) => data.quantity > 0.0001) // Small threshold for floating point
    .map(([asset]) => asset);

  if (assetsWithHoldings.length === 0) {
    return NextResponse.json({
      holdings: [],
      allocation: [],
      pnlData: [],
      summary: {
        totalValue: 0,
        totalCost: 0,
        totalPnl: 0,
        totalPnlPercent: 0,
        btcPrice: 0,
      },
    });
  }

  // Fetch current prices
  const prices = await getCurrentPrices(assetsWithHoldings);
  const btcPrice = prices['BTC'] || 0;

  // Fetch prices from 7 days ago for performance calculation
  const now = Math.floor(Date.now() / 1000);
  const sevenDaysAgo = now - 7 * 24 * 60 * 60;
  const historicalPrices = await getHistoricalPrices(assetsWithHoldings, sevenDaysAgo, sevenDaysAgo);

  // Create map of 7-day-ago prices
  const prices7dAgo: Record<string, number> = {};
  for (const hp of historicalPrices) {
    prices7dAgo[hp.asset.toUpperCase()] = hp.price_usd;
  }

  // Calculate holdings with current values and 7-day performance
  const holdings = assetsWithHoldings.map(asset => {
    const data = holdingsMap[asset];
    const currentPrice = isStablecoin(asset) ? 1 : (prices[asset] || 0);
    const currentValue = data.quantity * currentPrice;
    const pnl = currentValue - data.costBasis;
    const pnlPercent = data.costBasis > 0 ? (pnl / data.costBasis) * 100 : 0;

    // Calculate 7-day price change
    const price7dAgo = isStablecoin(asset) ? 1 : (prices7dAgo[asset] || currentPrice);
    const change7d = currentPrice - price7dAgo;
    const change7dPercent = price7dAgo > 0 ? (change7d / price7dAgo) * 100 : 0;
    // Value change based on current holdings
    const value7dAgo = data.quantity * price7dAgo;
    const valueChange7d = currentValue - value7dAgo;

    return {
      asset,
      quantity: data.quantity,
      currentPrice,
      currentValue,
      costBasis: data.costBasis,
      pnl,
      pnlPercent,
      change7dPercent,
      valueChange7d,
      color: getAssetColor(asset),
    };
  }).sort((a, b) => b.currentValue - a.currentValue);

  // Calculate totals
  const totalValue = holdings.reduce((sum, h) => sum + h.currentValue, 0);
  const totalCost = holdings.reduce((sum, h) => sum + h.costBasis, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPercent = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  // Allocation data (for pie chart)
  const allocation = holdings
    .filter(h => h.currentValue > 0)
    .map(h => ({
      asset: h.asset,
      value: h.currentValue,
      percentage: totalValue > 0 ? (h.currentValue / totalValue) * 100 : 0,
      color: h.color,
    }));

  // P&L data (for treemap) - exclude stablecoins, sort by absolute P&L
  const pnlData = holdings
    .filter(h => !isStablecoin(h.asset) && h.pnl !== 0)
    .map(h => ({
      asset: h.asset,
      pnl: h.pnl,
      pnlPercent: h.pnlPercent,
      color: h.pnl >= 0 ? '#16a34a' : '#dc2626',
    }))
    .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));

  // 7-day performance data (for treemap showing recent performance)
  const performance7d = holdings
    .filter(h => !isStablecoin(h.asset) && h.valueChange7d !== 0)
    .map(h => ({
      asset: h.asset,
      change: h.valueChange7d,
      changePercent: h.change7dPercent,
      color: h.valueChange7d >= 0 ? '#16a34a' : '#dc2626',
    }))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

  // Calculate total 7-day change
  const totalChange7d = holdings.reduce((sum, h) => sum + h.valueChange7d, 0);
  const totalValue7dAgo = totalValue - totalChange7d;
  const totalChange7dPercent = totalValue7dAgo > 0 ? (totalChange7d / totalValue7dAgo) * 100 : 0;

  return NextResponse.json({
    holdings,
    allocation,
    pnlData,
    performance7d,
    summary: {
      totalValue,
      totalCost,
      totalPnl,
      totalPnlPercent,
      totalChange7d,
      totalChange7dPercent,
      btcPrice,
    },
  }, {
    headers: {
      'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=120',
    },
  });
}
