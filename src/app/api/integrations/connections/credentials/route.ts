import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import { withServerAuthRateLimit } from '@/lib/api/route-auth';
import { exchangeSchema } from '@/lib/integrations/request-schemas';

export const GET = withServerAuthRateLimit(async (req: NextRequest, auth) => {
  const exchangeParam = req.nextUrl.searchParams.get('exchange');
  const parsedExchange = exchangeSchema.safeParse((exchangeParam || '').toLowerCase());
  if (!parsedExchange.success) {
    return NextResponse.json({ error: 'exchange param required' }, { status: 400 });
  }
  const exchange = parsedExchange.data;

  const connection = await prisma.exchangeConnection.findUnique({
    where: { userId_exchange: { userId: auth.userId, exchange } },
  });

  if (!connection) {
    return NextResponse.json({ found: false });
  }

  return NextResponse.json({
    found: true,
    apiKeyPreview: maskKey(decrypt(connection.apiKey)),
    hasStoredSecret: true,
    label: connection.label,
    portfolioId: connection.portfolioId,
    autoSyncEnabled: connection.autoSyncEnabled,
    lastSyncAt: connection.lastSyncAt,
    lastAutoSyncAt: connection.lastAutoSyncAt,
    lastSyncStatus: connection.lastSyncStatus,
    lastSyncMessage: connection.lastSyncMessage,
  });
});

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}
