import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { encrypt, decrypt } from '@/lib/encryption';
import { withServerAuthRateLimit } from '@/lib/api/route-auth';
import {
  connectionCreateBodySchema,
  connectionUpdateBodySchema,
  exchangeSchema,
} from '@/lib/integrations/request-schemas';

export const GET = withServerAuthRateLimit(async (req: NextRequest, auth) => {
  const exchangeParam = req.nextUrl.searchParams.get('exchange');
  const exchangeResult = exchangeParam
    ? exchangeSchema.safeParse(exchangeParam.toLowerCase())
    : null;

  if (exchangeResult && !exchangeResult.success) {
    return NextResponse.json(
      { error: 'Invalid exchange parameter' },
      { status: 400 },
    );
  }
  const exchange = exchangeResult?.success ? exchangeResult.data : null;

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
});

export const POST = withServerAuthRateLimit(async (req: NextRequest, auth) => {
  const parsed = connectionCreateBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { exchange, apiKey, apiSecret, label, portfolioId, autoSyncEnabled } = parsed.data;

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
      label: label?.trim() || null,
      userId: auth.userId,
      portfolioId: normalizedPortfolioId === 'INVALID' ? null : normalizedPortfolioId ?? null,
      autoSyncEnabled: Boolean(autoSyncEnabled),
    },
    update: {
      apiKey: encrypt(apiKey),
      apiSecret: encrypt(apiSecret),
      label: label?.trim() || null,
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
});

export const PATCH = withServerAuthRateLimit(async (req: NextRequest, auth) => {
  const parsed = connectionUpdateBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { id, exchange, label, portfolioId, autoSyncEnabled } = parsed.data;

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

  if (label !== undefined) data.label = label?.trim() || null;
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
});

export const DELETE = withServerAuthRateLimit(async (req: NextRequest, auth) => {
  const exchangeParam = req.nextUrl.searchParams.get('exchange');
  const parsedExchange = exchangeSchema.safeParse((exchangeParam || '').toLowerCase());
  if (!parsedExchange.success) {
    return NextResponse.json({ error: 'exchange param required' }, { status: 400 });
  }
  const exchange = parsedExchange.data;

  await prisma.exchangeConnection.deleteMany({
    where: { userId: auth.userId, exchange },
  });

  return NextResponse.json({ deleted: true });
});

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
