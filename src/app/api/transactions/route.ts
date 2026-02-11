import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { TtlCache } from '@/lib/cache';
import type { Transaction } from '@prisma/client';
import { getServerAuth } from '@/lib/auth';

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

const TxBatchSchema = z.object({
  portfolioId: z.number().optional(),
  transactions: z.array(TxSchema).min(1),
});

const txCache = new TtlCache<string, Transaction[]>(15_000); // 15s cache

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const param = url.searchParams.get('portfolioId');
  const portfolioId = param === null ? 'all' : Number(param);
  const auth = await getServerAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
}

export async function POST(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const json = await req.json();

  // Support both single and batch creation (used for paired stablecoin transactions).
  const batchParsed = TxBatchSchema.safeParse(json);
  const singleParsed = batchParsed.success ? null : TxSchema.safeParse(json);
  if (!batchParsed.success && singleParsed && !singleParsed.success) {
    return NextResponse.json({ error: singleParsed.error.flatten() }, { status: 400 });
  }

  const portfolioIdRaw = Number((json as { portfolioId?: number }).portfolioId || 1);
  const portfolioId = Number.isFinite(portfolioIdRaw) ? portfolioIdRaw : -1;
  const portfolio = await prisma.portfolio.findFirst({ where: { id: portfolioId, userId: auth.userId } });
  if (!portfolio) return NextResponse.json({ error: 'Invalid portfolio' }, { status: 403 });

  // At this point, we know either batchParsed succeeded or singleParsed succeeded (due to earlier validation)
  // If batchParsed failed, singleParsed must have succeeded (we would have returned an error otherwise)
  type TxInput = z.infer<typeof TxSchema>;
  let txs: TxInput[];
  if (batchParsed.success) {
    txs = batchParsed.data.transactions;
  } else {
    // We know singleParsed exists and succeeded (we would have returned an error otherwise)
    if (!singleParsed || !singleParsed.success) {
      return NextResponse.json({ error: 'Invalid transaction data' }, { status: 400 });
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
      console.warn('[Transactions API] Background cache warm failed:', err);
    });
  }).catch(() => {
    // Ignore import errors in production builds
  });
  
  return NextResponse.json(batchParsed.success ? created : created[0], { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const json = await req.json();
  const id = Number(json?.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const parsed = TxSchema.partial().safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { datetime, ...rest } = parsed.data;
  // Ensure the transaction belongs to the authenticated user's portfolio
  const existing = await prisma.transaction.findFirst({ where: { id, portfolio: { userId: auth.userId } } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const updated = await prisma.transaction.update({ 
    where: { id }, 
    data: { 
      ...rest, 
      ...(datetime ? { datetime: new Date(datetime) } : {}) 
    } 
  });
  try { txCache.clear(); } catch {}
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const auth = await getServerAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const existing = await prisma.transaction.findFirst({ where: { id, portfolio: { userId: auth.userId } } });
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  await prisma.transaction.delete({ where: { id } });
  try { txCache.clear(); } catch {}
  return NextResponse.json({ ok: true });
}
