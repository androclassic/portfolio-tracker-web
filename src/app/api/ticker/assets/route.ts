import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/api-key';
import { rateLimitTicker } from '@/lib/rate-limit';
import { SUPPORTED_ASSETS } from '@/lib/assets';

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
  const limited = rateLimitTicker(req);
  if (limited) return limited;

  const apiKey = req.headers.get('x-api-key');

  if (!apiKey) {
    return NextResponse.json(
      { error: 'Unauthorized. Missing API key. Generate one from your account settings.' },
      { status: 401 },
    );
  }

  const { valid } = await validateApiKey(apiKey);

  if (!valid) {
    return NextResponse.json(
      { error: 'Unauthorized. Invalid or expired API key.' },
      { status: 401 },
    );
  }

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
