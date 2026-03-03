import { NextRequest, NextResponse } from 'next/server';
import { fetchKrakenLedger, parseKrakenCsv, type KrakenCredentials } from '@/lib/integrations/kraken';
import { withServerAuthRateLimit } from '@/lib/api/route-auth';
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import { credentialsFetchBodySchema } from '@/lib/integrations/request-schemas';

export const POST = withServerAuthRateLimit(async (req: NextRequest, auth) => {
  try {
    const parsed = credentialsFetchBodySchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    const { startDate, endDate } = parsed.data;
    let apiKey = parsed.data.apiKey?.trim();
    let apiSecret = parsed.data.apiSecret?.trim();

    if (!apiKey || !apiSecret) {
      const connection = await prisma.exchangeConnection.findUnique({
        where: {
          userId_exchange: {
            userId: auth.userId,
            exchange: 'kraken',
          },
        },
        select: { apiKey: true, apiSecret: true },
      });
      if (!connection) {
        return NextResponse.json(
          { error: 'No saved Kraken credentials found. Provide API key and secret first.' },
          { status: 400 },
        );
      }
      apiKey = decrypt(connection.apiKey);
      apiSecret = decrypt(connection.apiSecret);
    }
    if (!apiKey || !apiSecret) {
      return NextResponse.json({ error: 'API credentials are required' }, { status: 400 });
    }

    const creds: KrakenCredentials = { apiKey, apiSecret };
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

    const ledgerRows = await fetchKrakenLedger(creds, start, end);
    const result = parseKrakenCsv(ledgerRows);

    return NextResponse.json({
      trades: result.trades,
      count: result.trades.length,
      rawCount: ledgerRows.length,
      skippedTypes: result.skippedTypes,
      warnings: result.warnings,
      unsupportedAssets: result.unsupportedAssets,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch ledger';
    return NextResponse.json({ error: message }, { status: 500 });
  }
});

function parseDateInput(value?: string): Date | undefined {
  if (!value || !value.trim()) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  return parsed;
}
