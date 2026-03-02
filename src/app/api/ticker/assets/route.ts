import { NextRequest, NextResponse } from 'next/server';
import { SUPPORTED_ASSETS } from '@/lib/assets';
import { authenticateTickerRequest } from '@/lib/ticker-auth';

/**
 * Ticker API - Returns the list of supported assets
 *
 * Authentication: API Key via X-API-Key header
 *
 * Query params:
 *   - category: optional filter — "major" | "altcoin" | "stablecoin" | "fiat" | "crypto"
 *               "crypto" is a shorthand for major + altcoin + stablecoin (excludes fiat)
 *
 * Returns:
 *   - assets: array of { symbol, name, category }
 *   - count: number of assets returned
 */

export async function GET(req: NextRequest) {
  const authResult = await authenticateTickerRequest(req);
  if (authResult instanceof NextResponse) return authResult;

  const url = new URL(req.url);
  const category = url.searchParams.get('category')?.toLowerCase();

  let assets = SUPPORTED_ASSETS.map(({ symbol, name, category }) => ({
    symbol,
    name,
    category,
  }));

  if (category) {
    if (category === 'crypto') {
      // Shorthand: everything except fiat
      assets = assets.filter((a) => a.category !== 'fiat');
    } else {
      assets = assets.filter((a) => a.category === category);
    }
  }

  return NextResponse.json(
    { assets, count: assets.length },
    {
      headers: {
        'Cache-Control': 'private, max-age=3600, stale-while-revalidate=7200',
      },
    },
  );
}
