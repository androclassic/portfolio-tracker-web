import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth';
import type { NormalizedTrade } from '@/lib/integrations/crypto-com';
import {
  importNormalizedTrades,
  type ImportSource,
} from '@/lib/integrations/import-normalized-trades';

interface CreateImportRouteOptions {
  exchangeName: string;
  defaultSource: ImportSource;
}

interface ImportBody {
  trades?: NormalizedTrade[];
  portfolioId?: number;
  importSource?: ImportSource;
}

export function createImportRoute({
  exchangeName,
  defaultSource,
}: CreateImportRouteOptions) {
  return async function POST(req: NextRequest) {
    const auth = await getServerAuth(req);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
      const body = (await req.json()) as ImportBody;
      const trades = body?.trades;
      const portfolioId = Number(body?.portfolioId);

      if (!Array.isArray(trades) || trades.length === 0) {
        return NextResponse.json({ error: 'No trades to import' }, { status: 400 });
      }

      if (!Number.isFinite(portfolioId) || portfolioId <= 0) {
        return NextResponse.json({ error: 'Portfolio ID is required' }, { status: 400 });
      }

      const source = body?.importSource || defaultSource;
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
        message: `Successfully imported ${result.imported} trades from ${exchangeName}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import trades';
      return NextResponse.json({ error: message }, { status: 500 });
    }
  };
}
