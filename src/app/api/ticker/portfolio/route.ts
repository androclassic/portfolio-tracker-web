import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentPrices } from '@/lib/prices/service';
import { getAssetColor, STABLECOINS } from '@/lib/assets';

/**
 * Ticker API - Returns portfolio data for external display devices (e-ink ticker, etc.)
 *
 * Authentication: API Key via X-API-Key header
 * Set TICKER_API_KEY in your .env file
 *
 * Query params:
 *   - portfolioId: number (default: 1)
 *   - userId: string (required - the user ID whose portfolio to fetch)
 *
 * Returns:
 *   - holdings: array of { asset, quantity, currentPrice, currentValue, costBasis, pnl, pnlPercent, color }
 *   - allocation: array of { asset, value, percentage, color }
 *   - pnlData: array of { asset, pnl, color } sorted by absolute P&L
 *   - summary: { totalValue, totalCost, totalPnl, totalPnlPercent, btcPrice }
 */

function isStablecoin(asset: string): boolean {
  return STABLECOINS.includes(asset.toUpperCase());
}

export async function GET(req: NextRequest) {
  // Check API key
  const apiKey = req.headers.get('x-api-key');
  const expectedKey = process.env.TICKER_API_KEY;

  if (!expectedKey) {
    return NextResponse.json(
      { error: 'Ticker API not configured. Set TICKER_API_KEY in environment.' },
      { status: 500 }
    );
  }

  if (!apiKey || apiKey !== expectedKey) {
    return NextResponse.json(
      { error: 'Unauthorized. Invalid or missing API key.' },
      { status: 401 }
    );
  }

  // Get query params
  const url = new URL(req.url);
  const portfolioId = Number(url.searchParams.get('portfolioId') || '1');
  const userId = url.searchParams.get('userId');

  if (!userId) {
    return NextResponse.json(
      { error: 'userId query parameter is required' },
      { status: 400 }
    );
  }

  // Fetch portfolio and verify ownership
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

  // Calculate holdings from transactions
  const holdingsMap: Record<string, { quantity: number; costBasis: number }> = {};

  for (const tx of transactions) {
    const asset = tx.asset.toUpperCase();
    if (!holdingsMap[asset]) {
      holdingsMap[asset] = { quantity: 0, costBasis: 0 };
    }

    const quantity = Number(tx.quantity) || 0;
    const costUsd = Number(tx.costUsd) || 0;

    if (tx.type === 'Buy' || tx.type === 'Deposit') {
      holdingsMap[asset].quantity += quantity;
      holdingsMap[asset].costBasis += costUsd;
    } else if (tx.type === 'Sell' || tx.type === 'Withdrawal') {
      // Proportionally reduce cost basis
      if (holdingsMap[asset].quantity > 0) {
        const ratio = quantity / holdingsMap[asset].quantity;
        holdingsMap[asset].costBasis -= holdingsMap[asset].costBasis * ratio;
      }
      holdingsMap[asset].quantity -= quantity;
    }
  }

  // Filter out assets with zero or negative holdings
  const assetsWithHoldings = Object.entries(holdingsMap)
    .filter(([_, data]) => data.quantity > 0)
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

  // Calculate holdings with current values
  const holdings = assetsWithHoldings.map(asset => {
    const data = holdingsMap[asset];
    const currentPrice = isStablecoin(asset) ? 1 : (prices[asset] || 0);
    const currentValue = data.quantity * currentPrice;
    const pnl = currentValue - data.costBasis;
    const pnlPercent = data.costBasis > 0 ? (pnl / data.costBasis) * 100 : 0;

    return {
      asset,
      quantity: data.quantity,
      currentPrice,
      currentValue,
      costBasis: data.costBasis,
      pnl,
      pnlPercent,
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

  return NextResponse.json({
    holdings,
    allocation,
    pnlData,
    summary: {
      totalValue,
      totalCost,
      totalPnl,
      totalPnlPercent,
      btcPrice,
    },
  }, {
    headers: {
      'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=120',
    },
  });
}
