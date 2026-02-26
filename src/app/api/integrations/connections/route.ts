import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { encrypt, decrypt } from '@/lib/encryption';

export async function GET(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const exchange = req.nextUrl.searchParams.get('exchange');

  const where = exchange
    ? { userId: auth.userId, exchange }
    : { userId: auth.userId };

  const connections = await prisma.exchangeConnection.findMany({ where });

  return NextResponse.json({
    connections: connections.map(c => ({
      id: c.id,
      exchange: c.exchange,
      label: c.label,
      apiKeyPreview: maskKey(decrypt(c.apiKey)),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { exchange, apiKey, apiSecret, label } = await req.json();

  if (!exchange || !apiKey || !apiSecret) {
    return NextResponse.json({ error: 'exchange, apiKey, and apiSecret are required' }, { status: 400 });
  }

  const connection = await prisma.exchangeConnection.upsert({
    where: { userId_exchange: { userId: auth.userId, exchange } },
    create: {
      exchange,
      apiKey: encrypt(apiKey),
      apiSecret: encrypt(apiSecret),
      label: label || null,
      userId: auth.userId,
    },
    update: {
      apiKey: encrypt(apiKey),
      apiSecret: encrypt(apiSecret),
      label: label || null,
    },
  });

  return NextResponse.json({
    id: connection.id,
    exchange: connection.exchange,
    apiKeyPreview: maskKey(apiKey),
    saved: true,
  });
}

export async function DELETE(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const exchange = req.nextUrl.searchParams.get('exchange');
  if (!exchange) return NextResponse.json({ error: 'exchange param required' }, { status: 400 });

  await prisma.exchangeConnection.deleteMany({
    where: { userId: auth.userId, exchange },
  });

  return NextResponse.json({ deleted: true });
}

function maskKey(key: string): string {
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}
