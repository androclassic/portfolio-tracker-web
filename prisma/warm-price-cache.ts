#!/usr/bin/env tsx
/**
 * Standalone script to warm the historical prices cache
 * Can be run manually or via cron job
 * 
 * Usage:
 *   npx tsx prisma/warm-price-cache.ts
 */

import { warmHistoricalPricesCache } from '../src/lib/prices/warm-cache';

async function main() {
  console.log('Starting cache warming...');
  const result = await warmHistoricalPricesCache();
  
  console.log('\n=== Cache Warming Results ===');
  console.log(`Assets processed: ${result.assetsProcessed}`);
  console.log(`Date ranges processed: ${result.dateRangesProcessed}`);
  console.log(`Total prices fetched: ${result.totalPricesFetched}`);
  
  if (result.errors.length > 0) {
    console.log(`\nErrors encountered: ${result.errors.length}`);
    result.errors.forEach(err => console.error(`  - ${err}`));
    process.exit(1);
  } else {
    console.log('\n✅ Cache warming completed successfully!');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

