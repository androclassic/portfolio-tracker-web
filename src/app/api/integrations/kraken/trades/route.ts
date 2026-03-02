import { NextRequest, NextResponse } from 'next/server';
import { fetchKrakenLedger, parseKrakenCsv, type KrakenCredentials } from '@/lib/integrations/kraken';
import { withServerAuthRateLimit } from '@/lib/api/route-auth';

export const POST = withServerAuthRateLimit(async (req: NextRequest) => {
  try {
    const { apiKey, apiSecret, startDate, endDate } = await req.json();
    if (!apiKey || !apiSecret) {
      return NextResponse.json({ error: 'API Key and Secret are required' }, { status: 400 });
    }

    const creds: KrakenCredentials = { apiKey, apiSecret };
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    const ledgerRows = await fetchKrakenLedger(creds, start, end);
    const result = parseKrakenCsv(ledgerRows);

    return NextResponse.json({
      trades: result.trades,
      count: result.trades.length,
      rawCount: ledgerRows.length,
      skippedTypes: result.skippedTypes,
      warnings: result.warnings,
      unsupportedAssets: result.unsupportedAssets,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch ledger';
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
