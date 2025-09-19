import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { TtlCache } from '@/lib/cache';
import type { Transaction } from '@prisma/client';
import { getServerAuth } from '@/lib/auth';

const TxSchema = z.object({
  asset: z.string().min(1),
  type: z.enum(['Buy','Sell','Deposit','Withdrawal']),
  priceUsd: z.number().nullable().optional(),
  quantity: z.number().nonnegative(),
  datetime: z.string(),
  feesUsd: z.number().nullable().optional(),
  costUsd: z.number().nullable().optional(),
  proceedsUsd: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
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
    return NextResponse.json(cached, { headers: { 'Cache-Control': 'public, max-age=5, s-maxage=5, stale-while-revalidate=15' } });
  }
  const whereBase = { portfolio: { userId: auth.userId } };
  const where = typeof portfolioId === 'number' && Number.isFinite(portfolioId) ? { ...whereBase, portfolioId } : whereBase;
  const rows = await prisma.transaction.findMany({ where, orderBy: { datetime: 'asc' } });
  txCache.set(key, rows);
  return NextResponse.json(rows, { headers: { 'Cache-Control': 'public, max-age=5, s-maxage=5, stale-while-revalidate=15' } });
}

export async function POST(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const json = await req.json();
  const parsed = TxSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { datetime, ...rest } = parsed.data;
  const portfolioId = Number((json as { portfolioId?: number }).portfolioId || 1);
  // Ensure portfolio belongs to the authenticated user
  const portfolio = await prisma.portfolio.findFirst({ where: { id: Number.isFinite(portfolioId)? portfolioId : -1, userId: auth.userId } });
  if (!portfolio) return NextResponse.json({ error: 'Invalid portfolio' }, { status: 403 });
  const created = await prisma.transaction.create({ 
    data: { 
      ...rest, 
      datetime: new Date(datetime), 
      portfolioId: portfolio.id 
    } 
  });
  // Invalidate cache
  try { txCache.clear(); } catch {}
  return NextResponse.json(created, { status: 201 });
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
