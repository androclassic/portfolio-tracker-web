import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import { withServerAuthRateLimit } from '@/lib/api/route-auth';

export const GET = withServerAuthRateLimit(async (req: NextRequest, auth) => {
  const exchange = req.nextUrl.searchParams.get('exchange');
  if (!exchange) return NextResponse.json({ error: 'exchange param required' }, { status: 400 });

  const connection = await prisma.exchangeConnection.findUnique({
    where: { userId_exchange: { userId: auth.userId, exchange } },
  });

  if (!connection) {
    return NextResponse.json({ found: false });
  }

  return NextResponse.json({
    found: true,
    apiKey: decrypt(connection.apiKey),
    apiSecret: decrypt(connection.apiSecret),
    label: connection.label,
    portfolioId: connection.portfolioId,
    autoSyncEnabled: connection.autoSyncEnabled,
    lastSyncAt: connection.lastSyncAt,
    lastAutoSyncAt: connection.lastAutoSyncAt,
    lastSyncStatus: connection.lastSyncStatus,
    lastSyncMessage: connection.lastSyncMessage,
  });
});
