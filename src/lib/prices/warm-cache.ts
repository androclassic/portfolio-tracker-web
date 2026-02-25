import { prisma } from '@/lib/prisma';
import { getHistoricalPrices } from './service';
import { isStablecoin } from '../assets';

/**
 * Get all unique assets and date ranges from all transactions
 */
export async function getAssetsAndDateRanges(): Promise<{
  assets: string[];
  dateRanges: Array<{ start: number; end: number }>;
}> {
  const transactions = await prisma.transaction.findMany({
    select: {
      fromAsset: true,
      toAsset: true,
      datetime: true,
    },
    orderBy: { datetime: 'asc' },
  });

  if (transactions.length === 0) {
    return { assets: [], dateRanges: [] };
  }

  // Collect all unique assets (excluding USD and stablecoins - they're handled separately)
  const assetSet = new Set<string>();
  for (const tx of transactions) {
    if (tx.fromAsset && tx.fromAsset.toUpperCase() !== 'USD' && !isStablecoin(tx.fromAsset)) {
      assetSet.add(tx.fromAsset.toUpperCase());
    }
    if (tx.toAsset && tx.toAsset.toUpperCase() !== 'USD' && !isStablecoin(tx.toAsset)) {
      assetSet.add(tx.toAsset.toUpperCase());
    }
  }

  const assets = Array.from(assetSet).sort();

  // Calculate date range from all transactions
  const dates = transactions.map(tx => new Date(tx.datetime).getTime());
  const minDate = Math.min(...dates);

  // Add buffer: 30 days before first transaction, extend to today
  const startUnixSec = Math.floor((minDate - 30 * 24 * 60 * 60 * 1000) / 1000);
  const endUnixSec = Math.floor(Date.now() / 1000);

  // Split into 3-month chunks to match the client-side chunking logic
  const dateRanges: Array<{ start: number; end: number }> = [];
  let currentStart = startUnixSec;
  const threeMonthsInSec = 3 * 30 * 24 * 60 * 60;

  while (currentStart < endUnixSec) {
    const currentEnd = Math.min(currentStart + threeMonthsInSec, endUnixSec);
    dateRanges.push({ start: currentStart, end: currentEnd });
    currentStart = currentEnd + 1; // Start next chunk 1 second after previous
  }

  return { assets, dateRanges };
}

/**
 * Warm the historical prices cache by pre-fetching prices for all assets in transactions
 */
export async function warmHistoricalPricesCache(): Promise<{
  assetsProcessed: number;
  dateRangesProcessed: number;
  totalPricesFetched: number;
  errors: string[];
}> {
  const result = {
    assetsProcessed: 0,
    dateRangesProcessed: 0,
    totalPricesFetched: 0,
    errors: [] as string[],
  };

  try {
    const { assets, dateRanges } = await getAssetsAndDateRanges();

    if (assets.length === 0) {
      console.log('[Cache Warm] No assets found in transactions');
      return result;
    }

    console.log(`[Cache Warm] Found ${assets.length} assets across ${dateRanges.length} date ranges`);

    // Process assets in batches to avoid overwhelming the API
    const assetBatchSize = 5;
    for (let i = 0; i < assets.length; i += assetBatchSize) {
      const assetBatch = assets.slice(i, i + assetBatchSize);
      
      for (const dateRange of dateRanges) {
        try {
          console.log(
            `[Cache Warm] Fetching prices for ${assetBatch.join(', ')} from ${new Date(dateRange.start * 1000).toISOString().slice(0, 10)} to ${new Date(dateRange.end * 1000).toISOString().slice(0, 10)}`
          );
          
          const prices = await getHistoricalPrices(
            assetBatch,
            dateRange.start,
            dateRange.end
          );

          result.totalPricesFetched += prices.length;
          result.dateRangesProcessed++;
          
          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));
        } catch (error) {
          const errorMsg = `Error fetching prices for ${assetBatch.join(', ')} (${dateRange.start}-${dateRange.end}): ${error instanceof Error ? error.message : String(error)}`;
          console.error('[Cache Warm]', errorMsg);
          result.errors.push(errorMsg);
        }
      }
      
      result.assetsProcessed += assetBatch.length;
    }

    console.log(
      `[Cache Warm] Complete: ${result.assetsProcessed} assets, ${result.dateRangesProcessed} date ranges, ${result.totalPricesFetched} prices cached`
    );
  } catch (error) {
    const errorMsg = `Fatal error during cache warm: ${error instanceof Error ? error.message : String(error)}`;
    console.error('[Cache Warm]', errorMsg);
    result.errors.push(errorMsg);
  }

  return result;
}

