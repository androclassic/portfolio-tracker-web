import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { TtlCache } from '@/lib/cache';
import type { Transaction } from '@prisma/client';
import { withServerAuthRateLimit } from '@/lib/api/route-auth';
import { createLogger } from '@/lib/logger';
import { apiCreated, apiError, apiValidationError, apiNotFound, apiDeleted } from '@/lib/api/responses';

const log = createLogger('Transactions API');

const TxSchema = z.object({
  type: z.enum(['Deposit','Withdrawal','Swap']),
  datetime: z.string(),
  feesUsd: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  
  // For Swap transactions: what you give up
  fromAsset: z.string().nullable().optional(),
  fromQuantity: z.number().nonnegative().nullable().optional(),
  fromPriceUsd: z.number().nullable().optional(),
  
  // What you receive/move (always populated)
  toAsset: z.string().min(1),
  toQuantity: z.number().nonnegative(),
  toPriceUsd: z.number().nullable().optional(),
}).refine(
  (data) => {
    // For Swap transactions, fromAsset, fromQuantity, and fromPriceUsd must all be present
    if (data.type === 'Swap') {
      return data.fromAsset && data.fromQuantity && data.fromPriceUsd;
    }
    return true;
  },
  {
    message: 'Swap transactions require fromAsset, fromQuantity, and fromPriceUsd',
  }
);

const TxUpdateSchema = z.object({
  type: z.enum(['Deposit','Withdrawal','Swap']).optional(),
  datetime: z.string().optional(),
  feesUsd: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
  fromAsset: z.string().nullable().optional(),
  fromQuantity: z.number().nonnegative().nullable().optional(),
  fromPriceUsd: z.number().nullable().optional(),
  toAsset: z.string().min(1).optional(),
  toQuantity: z.number().nonnegative().optional(),
  toPriceUsd: z.number().nullable().optional(),
});

const TxBatchSchema = z.object({
  portfolioId: z.number().optional(),
  transactions: z.array(TxSchema).min(1),
});

const txCache = new TtlCache<string, Transaction[]>(15_000); // 15s cache

export const GET = withServerAuthRateLimit(async (req: NextRequest, auth) => {
  const url = new URL(req.url);
  const param = url.searchParams.get('portfolioId');
  const portfolioId = param === null ? 'all' : Number(param);
  const key = `transactions:list:${String(portfolioId)}`;
  const cached = txCache.get(key);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=15' } });
  }
  const whereBase = { portfolio: { userId: auth.userId } };
  const where = typeof portfolioId === 'number' && Number.isFinite(portfolioId) ? { ...whereBase, portfolioId } : whereBase;
  const rows = await prisma.transaction.findMany({ where, orderBy: { datetime: 'asc' } });
  txCache.set(key, rows);
  return NextResponse.json(rows, { headers: { 'Cache-Control': 'private, max-age=5, stale-while-revalidate=15' } });
});

export const POST = withServerAuthRateLimit(async (req: NextRequest, auth) => {
  const json = await req.json();

  // Support both single and batch creation (used for paired stablecoin transactions).
  const batchParsed = TxBatchSchema.safeParse(json);
  const singleParsed = batchParsed.success ? null : TxSchema.safeParse(json);
  if (!batchParsed.success && singleParsed && !singleParsed.success) {
    return apiValidationError(singleParsed.error);
  }

  const portfolioIdRaw = Number((json as { portfolioId?: number }).portfolioId || 1);
  const portfolioId = Number.isFinite(portfolioIdRaw) ? portfolioIdRaw : -1;
  const portfolio = await prisma.portfolio.findFirst({ where: { id: portfolioId, userId: auth.userId } });
  if (!portfolio) return apiError('Invalid portfolio', 403);

  // At this point, we know either batchParsed succeeded or singleParsed succeeded (due to earlier validation)
  // If batchParsed failed, singleParsed must have succeeded (we would have returned an error otherwise)
  type TxInput = z.infer<typeof TxSchema>;
  let txs: TxInput[];
  if (batchParsed.success) {
    txs = batchParsed.data.transactions;
  } else {
    // We know singleParsed exists and succeeded (we would have returned an error otherwise)
    if (!singleParsed || !singleParsed.success) {
      return apiError('Invalid transaction data');
    }
    txs = [singleParsed.data];
  }
  const created = await prisma.$transaction(
    txs.map((t) => {
      const { datetime, toAsset, fromAsset, ...rest } = t;
      return prisma.transaction.create({
        data: {
          ...rest,
          toAsset: toAsset.toUpperCase(),
          fromAsset: fromAsset ? fromAsset.toUpperCase() : null,
          datetime: new Date(datetime),
          portfolioId: portfolio.id,
        },
      });
    })
  );

  try { txCache.clear(); } catch {}
  
  // Trigger cache warming in background when new transactions are added
  // This ensures prices are pre-fetched for new assets
  import('@/lib/prices/warm-cache').then(({ warmHistoricalPricesCache }) => {
    warmHistoricalPricesCache().catch(err => {
      log.warn('Background cache warm failed', err);
    });
  }).catch(() => {
    // Ignore import errors in production builds
  });
  
  return apiCreated(batchParsed.success ? created : created[0]);
});

export const PUT = withServerAuthRateLimit(async (req: NextRequest, auth) => {
  const json = await req.json();
  const id = Number(json?.id);
  if (!Number.isFinite(id)) return apiError('Invalid id');
  const parsed = TxUpdateSchema.safeParse(json);
  if (!parsed.success) return apiValidationError(parsed.error);
  const { datetime, ...rest } = parsed.data;
  // Ensure the transaction belongs to the authenticated user's portfolio
  const existing = await prisma.transaction.findFirst({ where: { id, portfolio: { userId: auth.userId } } });
  if (!existing) return apiNotFound('Transaction');
  const updated = await prisma.transaction.update({ 
    where: { id }, 
    data: { 
      ...rest, 
      ...(datetime ? { datetime: new Date(datetime) } : {}) 
    } 
  });
  try { txCache.clear(); } catch {}
  return NextResponse.json(updated);
});

export const DELETE = withServerAuthRateLimit(async (req: NextRequest, auth) => {
  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isFinite(id)) return apiError('Invalid id');
  const existing = await prisma.transaction.findFirst({ where: { id, portfolio: { userId: auth.userId } } });
  if (!existing) return apiNotFound('Transaction');
  await prisma.transaction.delete({ where: { id } });
  try { txCache.clear(); } catch {}
  return apiDeleted();
});
