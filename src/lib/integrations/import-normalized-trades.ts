import { prisma } from '@/lib/prisma';
import type { NormalizedTrade } from './crypto-com';
import { enrichTradesWithPrices } from './enrich-prices';

export type ImportSource = 'crypto-com-api' | 'crypto-com-csv' | 'kraken-api' | 'kraken-csv';

export interface ImportNormalizedTradesInput {
  userId: string;
  portfolioId: number;
  source: ImportSource;
  trades: NormalizedTrade[];
}

export interface ImportNormalizedTradesResult {
  processed: number;
  imported: number;
  duplicates: number;
}

export async function importNormalizedTrades({
  userId,
  portfolioId,
  source,
  trades,
}: ImportNormalizedTradesInput): Promise<ImportNormalizedTradesResult> {
  if (!Array.isArray(trades) || trades.length === 0) {
    return { processed: 0, imported: 0, duplicates: 0 };
  }

  const portfolio = await prisma.portfolio.findFirst({
    where: { id: portfolioId, userId },
    select: { id: true },
  });

  if (!portfolio) {
    throw new Error('Portfolio not found');
  }

  const toNum = (v: unknown): number => {
    if (v == null) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  const toNumOrNull = (v: unknown): number | null => {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const enriched = await enrichTradesWithPrices(trades);
  const externalIds = Array.from(
    new Set(
      enriched
        .map(t => (t.externalId || '').trim())
        .filter(v => v.length > 0)
    )
  );

  const existing = externalIds.length > 0
    ? await prisma.transaction.findMany({
      where: {
        portfolioId,
        importSource: source,
        importExternalId: { in: externalIds },
      },
      select: { importExternalId: true },
    })
    : [];

  const existingSet = new Set(existing.map(t => t.importExternalId).filter((v): v is string => !!v));

  const pending = enriched.filter((trade) => {
    const externalId = (trade.externalId || '').trim();
    if (!externalId) return true; // If no external id, we cannot dedupe confidently.
    return !existingSet.has(externalId);
  });

  if (pending.length === 0) {
    return { processed: enriched.length, imported: 0, duplicates: enriched.length };
  }

  const chunkSize = 500;
  let imported = 0;

  for (let i = 0; i < pending.length; i += chunkSize) {
    const chunk = pending.slice(i, i + chunkSize);
    const result = await prisma.transaction.createMany({
      data: chunk.map((trade) => ({
        type: trade.type || 'Swap',
        datetime: new Date(trade.datetime),
        fromAsset: trade.fromAsset || null,
        fromQuantity: toNum(trade.fromQuantity),
        fromPriceUsd: toNumOrNull(trade.fromPriceUsd),
        toAsset: trade.toAsset,
        toQuantity: toNum(trade.toQuantity),
        toPriceUsd: toNumOrNull(trade.toPriceUsd),
        feesUsd: toNumOrNull(trade.feesUsd),
        notes: withSourceTag(source, trade.notes),
        portfolioId,
        importSource: source,
        importExternalId: (trade.externalId || '').trim() || null,
      })),
    });
    imported += result.count;
  }

  return {
    processed: enriched.length,
    imported,
    duplicates: enriched.length - imported,
  };
}

function withSourceTag(source: ImportSource, notes: string | null | undefined): string {
  const tag = source.startsWith('crypto-com') ? '[Crypto.com]' : '[Kraken]';
  const content = (notes || '').trim();
  if (!content) return tag;
  if (content.startsWith(tag)) return content;
  return `${tag} ${content}`;
}
