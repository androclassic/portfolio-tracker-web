import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import crypto from 'crypto';

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function validateApiKey(apiKey: string): Promise<{ valid: boolean; userId?: string }> {
  if (!apiKey) {
    return { valid: false };
  }

  const hashedKey = hashApiKey(apiKey);

  // Find the API key in database
  const keyRecord = await prisma.apiKey.findFirst({
    where: {
      key: hashedKey,
      revokedAt: null, // Not revoked
      OR: [
        { expiresAt: null }, // No expiration
        { expiresAt: { gt: new Date() } }, // Not expired
      ],
    },
    select: {
      id: true,
      userId: true,
    },
  });

  if (!keyRecord) {
    return { valid: false };
  }

  // Update last used timestamp (fire and forget)
  prisma.apiKey.update({
    where: { id: keyRecord.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {}); // Ignore errors

  return { valid: true, userId: keyRecord.userId };
}

export async function POST(req: NextRequest) {
  // Check API key (support both API key and session auth for backward compatibility)
  const apiKey = req.headers.get('x-api-key');
  let userId: string | undefined;

  if (apiKey) {
    const { valid, userId: apiUserId } = await validateApiKey(apiKey);
    if (!valid || !apiUserId) {
      return NextResponse.json(
        { error: 'Unauthorized. Invalid or expired API key.' },
        { status: 401 }
      );
    }
    userId = apiUserId;
  } else {
    // Fall back to session auth if no API key provided
    const { getServerAuth } = await import('@/lib/auth');
    const auth = await getServerAuth(req);
    if (!auth?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    userId = auth.user.id;
  }

  const url = new URL(req.url);
  const portfolioId = Number(url.searchParams.get('portfolioId') || '1');
  
  // Build where clause with user ownership check
  const where: Prisma.TransactionWhereInput = {
    portfolio: {
      userId: userId,
    },
  };
  
  if (Number.isFinite(portfolioId)) {
    where.portfolioId = portfolioId;
  }
  
  const rows = await prisma.transaction.findMany({ where, orderBy: { datetime: 'asc' } });
  
  const header = ['id','type','datetime','from_asset','from_quantity','from_price_usd','to_asset','to_quantity','to_price_usd','fees_usd','notes'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const vals = [
      r.id,
      r.type,
      new Date(r.datetime).toISOString(),
      r.fromAsset ?? '',
      r.fromQuantity ?? '',
      r.fromPriceUsd ?? '',
      r.toAsset,
      r.toQuantity,
      r.toPriceUsd ?? '',
      r.feesUsd ?? '',
      (r.notes || '').replace(/\"/g,'\"\"'),
    ];
    const line = vals.map(v => typeof v === 'string' ? `"${v}"` : String(v)).join(',');
    lines.push(line);
  }
  const csv = lines.join('\n');
  return new NextResponse(csv, { 
    headers: { 
      'Content-Type': 'text/csv; charset=utf-8', 
      'Content-Disposition': `attachment; filename="transactions_portfolio_${portfolioId}.csv"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    } 
  });
}


