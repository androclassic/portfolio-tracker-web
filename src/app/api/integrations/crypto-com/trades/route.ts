import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth';
import { fetchTrades, normalizeTrades, type CryptoComCredentials } from '@/lib/integrations/crypto-com';

export async function POST(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { apiKey, apiSecret, startDate, endDate, instrumentName } = body;

    if (!apiKey || !apiSecret) {
      return NextResponse.json({ error: 'API Key and Secret are required' }, { status: 400 });
    }

    const creds: CryptoComCredentials = { apiKey, apiSecret };

    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    const rawTrades = await fetchTrades(creds, start, end, instrumentName || undefined);

    let normalized;
    try {
      normalized = normalizeTrades(rawTrades);
    } catch (normError) {
      console.error('[Crypto.com] Normalization error:', normError);
      console.error('[Crypto.com] Raw trade sample:', JSON.stringify(rawTrades.slice(0, 2)));
      return NextResponse.json({
        error: `Failed to process trades: ${normError instanceof Error ? normError.message : 'unknown error'}`,
        rawCount: rawTrades.length,
        sampleTrade: rawTrades[0] || null,
      }, { status: 500 });
    }

    return NextResponse.json({
      trades: normalized,
      count: normalized.length,
      rawCount: rawTrades.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch trades';
    console.error('[Crypto.com] API error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
