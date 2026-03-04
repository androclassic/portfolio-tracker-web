import { NextRequest, NextResponse } from 'next/server';
import { fetchTrades, normalizeTrades, type CryptoComCredentials } from '@/lib/integrations/crypto-com';
import { withServerAuthRateLimit } from '@/lib/api/route-auth';
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import { credentialsFetchBodySchema } from '@/lib/integrations/request-schemas';
import { createLogger } from '@/lib/logger';

const log = createLogger('Crypto.com');

export const POST = withServerAuthRateLimit(async (req: NextRequest, auth) => {
  try {
    const parsed = credentialsFetchBodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    const { startDate, endDate, instrumentName } = parsed.data;
    let apiKey = parsed.data.apiKey?.trim();
    let apiSecret = parsed.data.apiSecret?.trim();

    if (!apiKey || !apiSecret) {
      const connection = await prisma.exchangeConnection.findUnique({
        where: {
          userId_exchange: {
            userId: auth.userId,
            exchange: 'crypto-com',
          },
        },
        select: { apiKey: true, apiSecret: true },
      });
      if (!connection) {
        return NextResponse.json(
          { error: 'No saved Crypto.com credentials found. Provide API key and secret first.' },
          { status: 400 },
        );
      }
      apiKey = decrypt(connection.apiKey);
      apiSecret = decrypt(connection.apiSecret);
    }
    if (!apiKey || !apiSecret) {
      return NextResponse.json({ error: 'API credentials are required' }, { status: 400 });
    }

    const creds: CryptoComCredentials = { apiKey, apiSecret };

    const start = parseDateInput(startDate);
    const end = parseDateInput(endDate);
    if (startDate && !start) {
      return NextResponse.json({ error: 'Invalid startDate format' }, { status: 400 });
    }
    if (endDate && !end) {
      return NextResponse.json({ error: 'Invalid endDate format' }, { status: 400 });
    }
    if (start && end && start > end) {
      return NextResponse.json({ error: 'startDate cannot be after endDate' }, { status: 400 });
    }

    const rawTrades = await fetchTrades(creds, start, end, instrumentName || undefined);

    let normalized;
    try {
      normalized = normalizeTrades(rawTrades);
    } catch (normError) {
      log.error('Normalization error', normError);
      log.error('Raw trade sample', JSON.stringify(rawTrades.slice(0, 2)));
      return NextResponse.json({
        error: `Failed to process trades: ${normError instanceof Error ? normError.message : 'unknown error'}`,
        rawCount: rawTrades.length,
        sampleTrade: rawTrades[0] || null,
      }, { status: 500 });
    }

    return NextResponse.json({
      trades: normalized,
      count: normalized.length,
      rawCount: rawTrades.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch trades';
    log.error('API error', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

function parseDateInput(value?: string): Date | undefined {
  if (!value || !value.trim()) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  return parsed;
}
