import { NextRequest, NextResponse } from 'next/server';
import { warmHistoricalPricesCache } from '@/lib/prices/warm-cache';

/**
 * API route to warm the historical prices cache
 * Can be called manually or via a cron job
 * 
 * Usage:
 * - GET /api/prices/warm-cache - Warm cache for all assets in transactions
 */
export async function GET(req: NextRequest) {
  // Optional: Add authentication/authorization here if needed
  // For now, allow anyone to trigger cache warming (it's a read-only operation)
  
  try {
    // Run cache warming in background (don't wait for completion)
    // This allows the API to return immediately while cache warming happens
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
      {
        error: 'Failed to start cache warming',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

/**
 * POST endpoint to warm cache synchronously (waits for completion)
 * Useful for testing or when you want to wait for results
 */
export async function POST(req: NextRequest) {
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
      {
        error: 'Cache warming failed',
        message: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

