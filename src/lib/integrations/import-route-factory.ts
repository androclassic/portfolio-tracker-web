import { NextRequest, NextResponse } from 'next/server';
import type { NormalizedTrade } from '@/lib/integrations/crypto-com';
import {
  importNormalizedTrades,
  type ImportSource,
} from '@/lib/integrations/import-normalized-trades';
import { withServerAuthRateLimit } from '@/lib/api/route-auth';
import { importRequestBodySchema } from '@/lib/integrations/request-schemas';

interface CreateImportRouteOptions {
  exchangeName: string;
  defaultSource: ImportSource;
}

export function createImportRoute({
  exchangeName,
  defaultSource,
}: CreateImportRouteOptions) {
  return withServerAuthRateLimit(async function POST(req: NextRequest, auth) {
    try {
      const parsed = importRequestBodySchema.safeParse(await req.json().catch(() => null));
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid request body', details: parsed.error.flatten().fieldErrors },
          { status: 400 },
        );
      }
      const { trades, portfolioId, importSource } = parsed.data;
      const normalizedTrades = trades as NormalizedTrade[];

      const source = importSource || defaultSource;
      const result = await importNormalizedTrades({
        userId: auth.userId,
        portfolioId,
        source,
        trades: normalizedTrades,
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
  });
}
