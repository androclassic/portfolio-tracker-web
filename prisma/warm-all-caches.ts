/**
 * Script to warm all caches (historical prices and FX rates) on container startup
 * This ensures the first user gets fast responses
 */

import { PrismaClient } from '@prisma/client';
import { warmHistoricalPricesCache } from '../src/lib/prices/warm-cache';
import { preloadExchangeRates } from '../src/lib/exchange-rates';

const prisma = new PrismaClient();

async function warmAllCaches() {
  console.log('[Cache Warm] Starting cache warming process...');
  const startTime = Date.now();

  try {
    // Get all transactions to determine date ranges and assets
    const transactions = await prisma.transaction.findMany({
      orderBy: { datetime: 'asc' },
    });

    if (transactions.length === 0) {
      console.log('[Cache Warm] No transactions found. Skipping cache warming.');
      await prisma.$disconnect();
      return;
    }

    console.log(`[Cache Warm] Found ${transactions.length} transactions`);

    // Calculate date range from transactions
    const dates = transactions.map(t => new Date(t.datetime).toISOString().slice(0, 10));
    const minDate = dates.reduce((a, b) => (a < b ? a : b));
    const maxDate = dates.reduce((a, b) => (a > b ? a : b));

    console.log(`[Cache Warm] Date range: ${minDate} to ${maxDate}`);

    // Extract unique assets
    const assets = new Set<string>();
    for (const t of transactions) {
      if (t.fromAsset) {
        const a = t.fromAsset.toUpperCase();
        if (a !== 'USD') assets.add(a);
      }
      if (t.toAsset) {
        const a = t.toAsset.toUpperCase();
        if (a !== 'USD') assets.add(a);
      }
    }

    const assetList = Array.from(assets).sort();
    console.log(`[Cache Warm] Found ${assetList.length} unique assets: ${assetList.join(', ')}`);

    // Warm historical prices
    console.log('[Cache Warm] Warming historical prices...');
    const priceStartTime = Date.now();
    try {
      const priceResult = await warmHistoricalPricesCache();
      const priceDuration = Date.now() - priceStartTime;
      console.log(
        `[Cache Warm] Historical prices: ${priceResult.assetsProcessed} assets, ` +
        `${priceResult.dateRangesProcessed} date ranges, ` +
        `${priceResult.totalPricesFetched} prices cached in ${priceDuration}ms`
      );
      if (priceResult.errors.length > 0) {
        console.warn(`[Cache Warm] Price warming errors: ${priceResult.errors.length}`);
        priceResult.errors.slice(0, 5).forEach(err => console.warn(`  - ${err}`));
      }
    } catch (error) {
      console.error('[Cache Warm] Failed to warm historical prices:', error);
    }

    // Warm FX rates
    console.log('[Cache Warm] Warming FX rates...');
    const fxStartTime = Date.now();
    try {
      await preloadExchangeRates(minDate, maxDate);
      const fxDuration = Date.now() - fxStartTime;
      console.log(`[Cache Warm] FX rates cached in ${fxDuration}ms`);
    } catch (error) {
      console.error('[Cache Warm] Failed to warm FX rates:', error);
    }

    const totalDuration = Date.now() - startTime;
    console.log(`[Cache Warm] Cache warming completed in ${totalDuration}ms`);
  } catch (error) {
    console.error('[Cache Warm] Fatal error during cache warming:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  warmAllCaches()
    .then(() => {
      console.log('[Cache Warm] Successfully completed');
      process.exit(0);
    })
    .catch(error => {
      console.error('[Cache Warm] Failed:', error);
      process.exit(1);
    });
}

export { warmAllCaches };

