import { NextRequest, NextResponse } from 'next/server';
import { getHistoricalPrices } from '@/lib/prices/service';
import { rateLimitStandard } from '@/lib/rate-limit';

/**
 * API endpoint for historical prices
 * Uses multi-tier caching: in-memory -> database -> external API
 * Returns data as fast as possible using cached data
 */
export async function GET(req: NextRequest) {
  // Use IP-based rate limiting for this unauthenticated endpoint
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  const rl = rateLimitStandard(ip);
  if (rl) return rl;
  const startTime = performance.now();
  const url = new URL(req.url);
  const symbols = (url.searchParams.get('symbols')||'').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean);
  const start = Number(url.searchParams.get('start'));
  const end = Number(url.searchParams.get('end'));
  
  if (!symbols.length || !Number.isFinite(start) || !Number.isFinite(end)) {
    return NextResponse.json(
      { prices: [] },
      { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=7200' } }
    );
  }

  try {
    const prices = await getHistoricalPrices(symbols, Math.floor(start), Math.floor(end));
    const duration = performance.now() - startTime;
    
    // Log slow requests for debugging
    if (duration > 1000) {
      console.log(`[Prices API] Slow request: ${symbols.join(',')} (${duration.toFixed(0)}ms)`);
    }
    
    return NextResponse.json(
      { prices },
      { 
        headers: { 
          'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=7200',
          'X-Response-Time': `${duration.toFixed(0)}ms`
        } 
      }
    );
  } catch (error) {
    console.error('[Prices API] Error:', error);
    return NextResponse.json(
      { prices: [], error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
