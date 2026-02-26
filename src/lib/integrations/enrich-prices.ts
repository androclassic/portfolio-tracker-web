import { prisma } from '@/lib/prisma';
import { getHistoricalPrices } from '@/lib/prices/service';
import { isFiatCurrency, isStablecoin } from '@/lib/assets';
import type { NormalizedTrade } from './crypto-com';

export async function enrichTradesWithPrices(trades: NormalizedTrade[]): Promise<NormalizedTrade[]> {
  const assetsNeedingPrices = new Set<string>();
  let minTs = Infinity;
  let maxTs = -Infinity;

  for (const t of trades) {
    const ts = new Date(t.datetime).getTime() / 1000;
    if (ts < minTs) minTs = ts;
    if (ts > maxTs) maxTs = ts;

    if (t.fromAsset && !t.fromPriceUsd && needsPrice(t.fromAsset)) {
      assetsNeedingPrices.add(t.fromAsset.toUpperCase());
    }
    if (t.toAsset && !t.toPriceUsd && needsPrice(t.toAsset)) {
      assetsNeedingPrices.add(t.toAsset.toUpperCase());
    }
  }

  if (assetsNeedingPrices.size === 0) return trades;

  // Fetch historical prices from APIs
  try {
    const startSec = Math.floor(minTs) - 7 * 86400;
    const endSec = Math.floor(maxTs) + 7 * 86400;
    await getHistoricalPrices(Array.from(assetsNeedingPrices), startSec, endSec);
  } catch {
    // best-effort
  }

  // Build price lookup from database
  const priceMap = new Map<string, number>();
  try {
    const prices = await prisma.historicalPrice.findMany({
      where: {
        asset: { in: Array.from(assetsNeedingPrices) },
      },
      orderBy: { date: 'asc' },
    });
    for (const p of prices) {
      priceMap.set(`${p.asset}|${p.date}`, p.price_usd);
    }
  } catch {
    // best-effort
  }

  return trades.map(t => {
    const dateStr = new Date(t.datetime).toISOString().slice(0, 10);
    let fromPriceUsd = t.fromPriceUsd;
    let toPriceUsd = t.toPriceUsd;

    if (!fromPriceUsd && t.fromAsset && needsPrice(t.fromAsset)) {
      fromPriceUsd = findClosestPrice(priceMap, t.fromAsset.toUpperCase(), dateStr);
    }
    if (!toPriceUsd && t.toAsset && needsPrice(t.toAsset)) {
      toPriceUsd = findClosestPrice(priceMap, t.toAsset.toUpperCase(), dateStr);
    }

    if (isStableOrFiat(t.fromAsset)) fromPriceUsd = fromPriceUsd ?? 1;
    if (isStableOrFiat(t.toAsset)) toPriceUsd = toPriceUsd ?? 1;

    return { ...t, fromPriceUsd, toPriceUsd };
  });
}

function findClosestPrice(priceMap: Map<string, number>, asset: string, date: string): number | null {
  const exact = priceMap.get(`${asset}|${date}`);
  if (exact) return exact;

  // Try +/- 3 days
  const d = new Date(date);
  for (let offset = 1; offset <= 3; offset++) {
    const before = new Date(d);
    before.setDate(before.getDate() - offset);
    const after = new Date(d);
    after.setDate(after.getDate() + offset);

    const pBefore = priceMap.get(`${asset}|${before.toISOString().slice(0, 10)}`);
    if (pBefore) return pBefore;
    const pAfter = priceMap.get(`${asset}|${after.toISOString().slice(0, 10)}`);
    if (pAfter) return pAfter;
  }

  return null;
}

function needsPrice(asset: string): boolean {
  if (!asset) return false;
  return !isFiatCurrency(asset) && !isStablecoin(asset);
}

function isStableOrFiat(asset: string): boolean {
  if (!asset) return false;
  return isFiatCurrency(asset) || isStablecoin(asset);
}
