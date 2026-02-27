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
      portfolioId: c.portfolioId,
      autoSyncEnabled: c.autoSyncEnabled,
      lastSyncAt: c.lastSyncAt,
      lastAutoSyncAt: c.lastAutoSyncAt,
      lastSyncStatus: c.lastSyncStatus,
      lastSyncMessage: c.lastSyncMessage,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { exchange, apiKey, apiSecret, label, portfolioId, autoSyncEnabled } = await req.json();

  if (!exchange || !apiKey || !apiSecret) {
    return NextResponse.json({ error: 'exchange, apiKey, and apiSecret are required' }, { status: 400 });
  }

  const normalizedPortfolioId = await parseOwnedPortfolioId(portfolioId, auth.userId);
  if (portfolioId !== undefined && normalizedPortfolioId === 'INVALID') {
    return NextResponse.json({ error: 'Invalid portfolioId' }, { status: 400 });
  }

  const connection = await prisma.exchangeConnection.upsert({
    where: { userId_exchange: { userId: auth.userId, exchange } },
    create: {
      exchange,
      apiKey: encrypt(apiKey),
      apiSecret: encrypt(apiSecret),
      label: label || null,
      userId: auth.userId,
      portfolioId: normalizedPortfolioId === 'INVALID' ? null : normalizedPortfolioId ?? null,
      autoSyncEnabled: Boolean(autoSyncEnabled),
    },
    update: {
      apiKey: encrypt(apiKey),
      apiSecret: encrypt(apiSecret),
      label: label || null,
      ...(portfolioId !== undefined
        ? { portfolioId: normalizedPortfolioId === 'INVALID' ? null : normalizedPortfolioId ?? null }
        : {}),
      ...(autoSyncEnabled !== undefined ? { autoSyncEnabled: Boolean(autoSyncEnabled) } : {}),
    },
  });

  return NextResponse.json({
    id: connection.id,
    exchange: connection.exchange,
    apiKeyPreview: maskKey(apiKey),
    portfolioId: connection.portfolioId,
    autoSyncEnabled: connection.autoSyncEnabled,
    saved: true,
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, exchange, label, portfolioId, autoSyncEnabled } = await req.json();
  if (!id && !exchange) {
    return NextResponse.json({ error: 'id or exchange is required' }, { status: 400 });
  }

  const connection = await prisma.exchangeConnection.findFirst({
    where: {
      userId: auth.userId,
      ...(id ? { id: String(id) } : { exchange: String(exchange) }),
    },
  });

  if (!connection) {
    return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
  }

  const normalizedPortfolioId = await parseOwnedPortfolioId(portfolioId, auth.userId);
  if (portfolioId !== undefined && normalizedPortfolioId === 'INVALID') {
    return NextResponse.json({ error: 'Invalid portfolioId' }, { status: 400 });
  }

  const data: {
    label?: string | null;
    portfolioId?: number | null;
    autoSyncEnabled?: boolean;
  } = {};

  if (label !== undefined) data.label = label || null;
  if (portfolioId !== undefined) data.portfolioId = normalizedPortfolioId === 'INVALID' ? null : normalizedPortfolioId ?? null;
  if (autoSyncEnabled !== undefined) data.autoSyncEnabled = Boolean(autoSyncEnabled);

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 });
  }

  const updated = await prisma.exchangeConnection.update({
    where: { id: connection.id },
    data,
  });

  return NextResponse.json({
    id: updated.id,
    exchange: updated.exchange,
    label: updated.label,
    portfolioId: updated.portfolioId,
    autoSyncEnabled: updated.autoSyncEnabled,
    lastSyncAt: updated.lastSyncAt,
    lastAutoSyncAt: updated.lastAutoSyncAt,
    lastSyncStatus: updated.lastSyncStatus,
    lastSyncMessage: updated.lastSyncMessage,
    updated: true,
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

async function parseOwnedPortfolioId(
  value: unknown,
  userId: string
): Promise<number | null | undefined | 'INVALID'> {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const id = Number(value);
  if (!Number.isFinite(id) || id <= 0) return 'INVALID';
  const portfolio = await prisma.portfolio.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  return portfolio ? id : 'INVALID';
}
