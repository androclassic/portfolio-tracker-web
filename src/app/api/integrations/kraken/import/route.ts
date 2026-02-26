import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type { NormalizedTrade } from '@/lib/integrations/crypto-com';

export async function POST(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { trades, portfolioId } = body as { trades: NormalizedTrade[]; portfolioId: number };

    if (!trades || !Array.isArray(trades) || trades.length === 0) {
      return NextResponse.json({ error: 'No trades to import' }, { status: 400 });
    }

    if (!portfolioId) {
      return NextResponse.json({ error: 'Portfolio ID is required' }, { status: 400 });
    }

    const portfolio = await prisma.portfolio.findFirst({
      where: { id: portfolioId, userId: auth.userId },
    });

    if (!portfolio) {
      return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 });
    }

    const toNum = (v: unknown): number => {
      if (v == null) return 0;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    };
    const toNumOrNull = (v: unknown): number | null => {
      if (v == null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const created = await prisma.$transaction(
      trades.map(trade =>
        prisma.transaction.create({
          data: {
            type: trade.type || 'Swap',
            datetime: new Date(trade.datetime),
            fromAsset: trade.fromAsset || null,
            fromQuantity: toNum(trade.fromQuantity),
            fromPriceUsd: toNumOrNull(trade.fromPriceUsd),
            toAsset: trade.toAsset,
            toQuantity: toNum(trade.toQuantity),
            toPriceUsd: toNumOrNull(trade.toPriceUsd),
            feesUsd: toNumOrNull(trade.feesUsd),
            notes: trade.notes || null,
            portfolioId,
          },
        })
      )
    );

    return NextResponse.json({
      imported: created.length,
      message: `Successfully imported ${created.length} trades from Kraken`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to import trades';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
