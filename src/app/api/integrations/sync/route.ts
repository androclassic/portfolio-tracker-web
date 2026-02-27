import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { decrypt } from '@/lib/encryption';
import { fetchTrades, normalizeTrades, type NormalizedTrade } from '@/lib/integrations/crypto-com';
import { fetchKrakenLedger, parseKrakenCsv } from '@/lib/integrations/kraken';
import { importNormalizedTrades, type ImportSource } from '@/lib/integrations/import-normalized-trades';

const DAY_MS = 24 * 60 * 60 * 1000;
const AUTO_SYNC_INTERVAL_MS = DAY_MS;

type SyncExchange = 'crypto-com' | 'kraken' | 'all';

export async function POST(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const exchangeRaw = String(body?.exchange || 'all').toLowerCase();
    const exchange: SyncExchange = exchangeRaw === 'crypto-com' || exchangeRaw === 'kraken' ? exchangeRaw : 'all';
    const auto = Boolean(body?.auto);
    const days = auto ? 7 : clamp(Number(body?.days || 7), 1, 30);
    const now = new Date();
    const start = new Date(now.getTime() - days * DAY_MS);
    const dueThreshold = new Date(now.getTime() - AUTO_SYNC_INTERVAL_MS);

    const connections = await prisma.exchangeConnection.findMany({
      where: {
        userId: auth.userId,
        ...(exchange !== 'all' ? { exchange } : {}),
        ...(auto ? { autoSyncEnabled: true } : {}),
      },
      orderBy: { exchange: 'asc' },
    });

    if (connections.length === 0) {
      return NextResponse.json({
        synced: 0,
        imported: 0,
        duplicates: 0,
        skipped: 0,
        message: auto
          ? 'No auto-sync enabled exchange connections found.'
          : 'No exchange connections found. Connect an exchange first.',
        results: [],
      });
    }

    const defaultPortfolio = await prisma.portfolio.findFirst({
      where: { userId: auth.userId },
      orderBy: { id: 'asc' },
      select: { id: true },
    });

    const results: Array<{
      exchange: string;
      synced: boolean;
      imported: number;
      duplicates: number;
      processed: number;
      rawCount: number;
      skippedReason?: string;
      message: string;
    }> = [];

    let totalImported = 0;
    let totalDuplicates = 0;
    let totalProcessed = 0;
    let totalSynced = 0;
    let totalSkipped = 0;

    for (const connection of connections) {
      const connectionName = connection.exchange;

      if (auto && connection.lastAutoSyncAt && connection.lastAutoSyncAt > dueThreshold) {
        totalSkipped++;
        results.push({
          exchange: connectionName,
          synced: false,
          imported: 0,
          duplicates: 0,
          processed: 0,
          rawCount: 0,
          skippedReason: 'not-due-yet',
          message: 'Auto sync is not due yet for this connection.',
        });
        continue;
      }

      const portfolioId = connection.portfolioId ?? defaultPortfolio?.id ?? null;
      if (!portfolioId) {
        const message = 'No portfolio available for sync.';
        await prisma.exchangeConnection.update({
          where: { id: connection.id },
          data: {
            lastSyncAt: now,
            ...(auto ? { lastAutoSyncAt: now } : {}),
            lastSyncStatus: 'error',
            lastSyncMessage: message,
          },
        });
        totalSkipped++;
        results.push({
          exchange: connectionName,
          synced: false,
          imported: 0,
          duplicates: 0,
          processed: 0,
          rawCount: 0,
          skippedReason: 'no-portfolio',
          message,
        });
        continue;
      }

      try {
        const apiKey = decrypt(connection.apiKey);
        const apiSecret = decrypt(connection.apiSecret);

        let source: ImportSource;
        let rawCount = 0;
        let normalizedTrades: NormalizedTrade[];

        if (connection.exchange === 'crypto-com') {
          const rawTrades = await fetchTrades({ apiKey, apiSecret }, start, now);
          rawCount = rawTrades.length;
          normalizedTrades = normalizeTrades(rawTrades);
          source = 'crypto-com-api';
        } else if (connection.exchange === 'kraken') {
          const ledgerRows = await fetchKrakenLedger({ apiKey, apiSecret }, start, now);
          rawCount = ledgerRows.length;
          const parsed = parseKrakenCsv(ledgerRows);
          normalizedTrades = parsed.trades;
          source = 'kraken-api';
        } else {
          throw new Error(`Unsupported exchange: ${connection.exchange}`);
        }

        const importResult = await importNormalizedTrades({
          userId: auth.userId,
          portfolioId,
          source,
          trades: normalizedTrades,
        });

        const successMessage = `Imported ${importResult.imported} new transactions (${importResult.duplicates} duplicates skipped).`;
        await prisma.exchangeConnection.update({
          where: { id: connection.id },
          data: {
            portfolioId: connection.portfolioId ?? portfolioId,
            lastSyncAt: now,
            ...(auto ? { lastAutoSyncAt: now } : {}),
            lastSyncStatus: 'success',
            lastSyncMessage: successMessage,
          },
        });

        totalImported += importResult.imported;
        totalDuplicates += importResult.duplicates;
        totalProcessed += importResult.processed;
        totalSynced++;

        results.push({
          exchange: connectionName,
          synced: true,
          imported: importResult.imported,
          duplicates: importResult.duplicates,
          processed: importResult.processed,
          rawCount,
          message: successMessage,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Sync failed';
        await prisma.exchangeConnection.update({
          where: { id: connection.id },
          data: {
            lastSyncAt: now,
            ...(auto ? { lastAutoSyncAt: now } : {}),
            lastSyncStatus: 'error',
            lastSyncMessage: message.slice(0, 500),
          },
        });
        totalSkipped++;
        results.push({
          exchange: connectionName,
          synced: false,
          imported: 0,
          duplicates: 0,
          processed: 0,
          rawCount: 0,
          skippedReason: 'sync-error',
          message,
        });
      }
    }

    return NextResponse.json({
      windowDays: days,
      auto,
      synced: totalSynced,
      imported: totalImported,
      duplicates: totalDuplicates,
      processed: totalProcessed,
      skipped: totalSkipped,
      results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to sync exchange transactions';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}
