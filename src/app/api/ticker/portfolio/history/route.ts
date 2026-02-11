import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentPrices, getHistoricalPrices } from '@/lib/prices/service';
import { isStablecoin } from '@/lib/assets';
import { validateApiKey } from '@/lib/api-key';

/**
 * Ticker API - Returns historical daily portfolio values for chart display
 *
 * Authentication: API Key via X-API-Key header
 *
 * Query params:
 *   - portfolioId: number (default: 1)
 *   - days: number (default: 7, max: 90)
 *
 * Returns:
 *   - history: array of { date: "YYYY-MM-DD", totalValue: number }
 */

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key');

  if (!apiKey) {
    return NextResponse.json(
      { error: 'Unauthorized. Missing API key.' },
      { status: 401 }
    );
  }

  const { valid, userId } = await validateApiKey(apiKey);

  if (!valid || !userId) {
    return NextResponse.json(
      { error: 'Unauthorized. Invalid or expired API key.' },
      { status: 401 }
    );
  }

  const url = new URL(req.url);
  const portfolioId = Number(url.searchParams.get('portfolioId') || '1');
  const days = Math.min(Number(url.searchParams.get('days') || '7'), 90);

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
    return NextResponse.json({ history: [] });
  }

  // Build date range (today - N days ... today)
  const now = new Date();
  const dates: string[] = [];
  for (let i = days; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  // Single-pass: walk transactions and dates together (both sorted ascending)
  // to build cumulative holdings per day in O(dates + transactions) time
  const dailyHoldings: Record<string, Record<string, number>> = {};
  const holdings: Record<string, number> = {};
  let txIdx = 0;

  for (const date of dates) {
    const endOfDay = new Date(date + 'T23:59:59.999Z');

    // Apply all transactions up to this date
    while (txIdx < transactions.length && new Date(transactions[txIdx].datetime) <= endOfDay) {
      const tx = transactions[txIdx];

      if (tx.toAsset && tx.toQuantity) {
        const asset = tx.toAsset.toUpperCase();
        holdings[asset] = (holdings[asset] || 0) + Number(tx.toQuantity);
      }

      if (tx.fromAsset && tx.fromQuantity) {
        const asset = tx.fromAsset.toUpperCase();
        holdings[asset] = (holdings[asset] || 0) - Number(tx.fromQuantity);
      }

      txIdx++;
    }

    // Snapshot current holdings, filtering out zero/negative
    const filtered: Record<string, number> = {};
    for (const [asset, qty] of Object.entries(holdings)) {
      if (qty > 0.0001) {
        filtered[asset] = qty;
      }
    }
    dailyHoldings[date] = filtered;
  }

  // Collect all unique assets across all days
  const allAssets = new Set<string>();
  for (const holdings of Object.values(dailyHoldings)) {
    for (const asset of Object.keys(holdings)) {
      allAssets.add(asset);
    }
  }
  const assetList = Array.from(allAssets);

  if (assetList.length === 0) {
    return NextResponse.json({ history: dates.map(d => ({ date: d, totalValue: 0 })) });
  }

  // Fetch historical prices for the date range
  const startUnix = Math.floor(new Date(dates[0] + 'T00:00:00Z').getTime() / 1000);
  const endUnix = Math.floor(new Date(dates[dates.length - 2] + 'T23:59:59Z').getTime() / 1000);

  const historicalPrices = await getHistoricalPrices(assetList, startUnix, endUnix);

  // Build price lookup: date -> asset -> price
  const priceLookup: Record<string, Record<string, number>> = {};
  for (const hp of historicalPrices) {
    if (!priceLookup[hp.date]) priceLookup[hp.date] = {};
    priceLookup[hp.date][hp.asset.toUpperCase()] = hp.price_usd;
  }

  // Fetch current prices for today
  const currentPrices = await getCurrentPrices(assetList);
  const today = dates[dates.length - 1];
  priceLookup[today] = {};
  for (const [asset, price] of Object.entries(currentPrices)) {
    priceLookup[today][asset.toUpperCase()] = price;
  }

  // Calculate daily portfolio values
  const history = dates.map(date => {
    const holdings = dailyHoldings[date] || {};
    const prices = priceLookup[date] || {};
    let totalValue = 0;

    for (const [asset, qty] of Object.entries(holdings)) {
      const price = isStablecoin(asset) ? 1 : (prices[asset] || 0);
      totalValue += qty * price;
    }

    return {
      date,
      totalValue: Math.round(totalValue * 100) / 100,
    };
  });

  return NextResponse.json({ history }, {
    headers: {
      'Cache-Control': 'private, max-age=60, stale-while-revalidate=120',
    },
  });
}
