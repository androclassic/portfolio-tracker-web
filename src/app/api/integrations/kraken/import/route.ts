import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth';
import type { NormalizedTrade } from '@/lib/integrations/crypto-com';
import { importNormalizedTrades, type ImportSource } from '@/lib/integrations/import-normalized-trades';

export async function POST(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { trades, portfolioId, importSource } = body as {
      trades: NormalizedTrade[];
      portfolioId: number;
      importSource?: ImportSource;
    };

    if (!trades || !Array.isArray(trades) || trades.length === 0) {
      return NextResponse.json({ error: 'No trades to import' }, { status: 400 });
    }

    if (!portfolioId) {
      return NextResponse.json({ error: 'Portfolio ID is required' }, { status: 400 });
    }
    const source: ImportSource = importSource || 'kraken-api';
    const result = await importNormalizedTrades({
      userId: auth.userId,
      portfolioId,
      source,
      trades,
    });

    return NextResponse.json({
      imported: result.imported,
      duplicates: result.duplicates,
      processed: result.processed,
      message: `Successfully imported ${result.imported} trades from Kraken`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to import trades';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
