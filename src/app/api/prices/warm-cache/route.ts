import { NextRequest, NextResponse } from 'next/server';
import { warmHistoricalPricesCache } from '@/lib/prices/warm-cache';
import { getServerAuth } from '@/lib/auth';
import { rateLimitStandard } from '@/lib/rate-limit';

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
export async function GET(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rl = rateLimitStandard(auth.userId);
  if (rl) return rl;

  try {
    warmHistoricalPricesCache().catch(error => {
      console.error('[Cache Warm API] Background warming failed:', error);
    });

    return NextResponse.json({
      message: 'Cache warming started in background',
      status: 'started',
    });
  } catch (error) {
    console.error('[Cache Warm API] Error starting cache warm:', error);
    return NextResponse.json(
      { error: 'Failed to start cache warming' },
      { status: 500 }
    );
  }
}

/**
 * POST endpoint to warm cache synchronously (waits for completion)
 * Useful for testing or when you want to wait for results
 */
export async function POST(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rl2 = rateLimitStandard(auth.userId);
  if (rl2) return rl2;

  try {
    const result = await warmHistoricalPricesCache();

    return NextResponse.json({
      message: 'Cache warming completed',
      status: 'completed',
      ...result,
    });
  } catch (error) {
    console.error('[Cache Warm API] Error during cache warm:', error);
    return NextResponse.json(
      { error: 'Cache warming failed' },
      { status: 500 }
    );
  }
}
