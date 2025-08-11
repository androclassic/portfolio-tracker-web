import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { TtlCache } from '@/lib/cache';
import type { Transaction } from '@prisma/client';

const TxSchema = z.object({
  asset: z.string().min(1),
  type: z.enum(['Buy','Sell']),
  priceUsd: z.number().nullable().optional(),
  quantity: z.number().nonnegative(),
  datetime: z.string(),
  feesUsd: z.number().nullable().optional(),
  costUsd: z.number().nullable().optional(),
  proceedsUsd: z.number().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const txCache = new TtlCache<string, Transaction[]>(15_000); // 15s cache

export async function GET() {
  const key = 'transactions:list';
  const cached = txCache.get(key);
  if (cached) {
    return NextResponse.json(cached, { headers: { 'Cache-Control': 'public, max-age=5, s-maxage=5, stale-while-revalidate=15' } });
  }
  const rows = await prisma.transaction.findMany({ orderBy: { datetime: 'asc' } });
  txCache.set(key, rows);
  return NextResponse.json(rows, { headers: { 'Cache-Control': 'public, max-age=5, s-maxage=5, stale-while-revalidate=15' } });
}

export async function POST(req: NextRequest) {
  const json = await req.json();
  const parsed = TxSchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { datetime, ...rest } = parsed.data;
  const created = await prisma.transaction.create({ data: { ...rest, datetime: new Date(datetime) } });
  // Invalidate cache
  try { txCache.delete('transactions:list'); } catch {}
  return NextResponse.json(created, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const json = await req.json();
  const id = Number(json?.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const parsed = TxSchema.partial().safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { datetime, ...rest } = parsed.data as any;
  const updated = await prisma.transaction.update({ where: { id }, data: { ...rest, ...(datetime? { datetime: new Date(datetime) } : {}) } });
  try { txCache.delete('transactions:list'); } catch {}
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  await prisma.transaction.delete({ where: { id } });
  try { txCache.delete('transactions:list'); } catch {}
  return NextResponse.json({ ok: true });
}
