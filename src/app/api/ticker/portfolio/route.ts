import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentPrices, getHistoricalPrices } from '@/lib/prices/service';
import { getAssetColor, isStablecoin } from '@/lib/assets';
import { authenticateTickerRequest } from '@/lib/ticker-auth';
import { buildAssetPositions, valueAssetPositions } from '@/lib/portfolio-engine';

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

export async function GET(req: NextRequest) {
  const authResult = await authenticateTickerRequest(req);
  if (authResult instanceof NextResponse) return authResult;
  const { userId } = authResult;

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

  const positions = buildAssetPositions(transactions);
  const assetsWithHoldings = Object.entries(positions)
    .filter(([, data]) => data.quantity > 0.0001)
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

  const { holdings: valuedHoldings, summary } = valueAssetPositions(
    positions,
    prices,
    { isStablecoin },
  );

  // Calculate holdings with current values and 7-day performance
  const holdings = valuedHoldings
    .map((holding) => {
      // Calculate 7-day price change
      const price7dAgo = isStablecoin(holding.asset)
        ? 1
        : (prices7dAgo[holding.asset] || holding.currentPrice);
      const change7d = holding.currentPrice - price7dAgo;
      const change7dPercent = price7dAgo > 0 ? (change7d / price7dAgo) * 100 : 0;
      // Value change based on current holdings
      const value7dAgo = holding.quantity * price7dAgo;
      const valueChange7d = holding.currentValue - value7dAgo;

      return {
        asset: holding.asset,
        quantity: holding.quantity,
        currentPrice: holding.currentPrice,
        currentValue: holding.currentValue,
        costBasis: holding.costBasis,
        pnl: holding.unrealizedPnl,
        pnlPercent: holding.unrealizedPnlPercent,
        change7dPercent,
        valueChange7d,
        color: getAssetColor(holding.asset),
      };
    })
    .sort((a, b) => b.currentValue - a.currentValue);

  // Calculate totals
  const totalValue = summary.totalValue;
  const totalCost = summary.totalCost;
  const totalPnl = summary.totalUnrealizedPnl;
  const totalPnlPercent = summary.totalUnrealizedPnlPercent;

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
      'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
    },
  });
}
