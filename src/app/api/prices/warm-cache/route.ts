import { NextRequest, NextResponse } from 'next/server';
import { warmHistoricalPricesCache } from '@/lib/prices/warm-cache';
import { withServerAuthRateLimit } from '@/lib/api/route-auth';
import { createLogger } from '@/lib/logger';

const log = createLogger('Cache Warm API');

/**
 * API route to warm the historical prices cache
 * Can be called manually or via a cron job
 *
 * Requires authentication to prevent abuse (DoS vector).
 *
 * Usage:
 * - GET /api/prices/warm-cache - Warm cache in background (returns immediately)
 * - POST /api/prices/warm-cache - Warm cache synchronously (waits for completion)
 */
export const GET = withServerAuthRateLimit(async (req: NextRequest) => {
  void req;
  try {
    warmHistoricalPricesCache().catch(error => {
      log.error('Background warming failed', error);
    });

    return NextResponse.json({
      message: 'Cache warming started in background',
      status: 'started',
    });
  } catch (error) {
    log.error('Error starting cache warm', error);
    return NextResponse.json(
      { error: 'Failed to start cache warming' },
      { status: 500 }
    );
  }
});

/**
 * POST endpoint to warm cache synchronously (waits for completion)
 * Useful for testing or when you want to wait for results
 */
export const POST = withServerAuthRateLimit(async (req: NextRequest) => {
  void req;
  try {
    const result = await warmHistoricalPricesCache();

    return NextResponse.json({
      message: 'Cache warming completed',
      status: 'completed',
      ...result,
    });
  } catch (error) {
    log.error('Error during cache warm', error);
    return NextResponse.json(
      { error: 'Cache warming failed' },
      { status: 500 }
    );
  }
});
