import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';

export async function GET(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
  });
}
