import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerAuth } from '@/lib/auth';
import { rateLimitStandard } from '@/lib/rate-limit';

export async function GET(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rl = rateLimitStandard(auth.userId);
  if (rl) return rl;
  
  // Get only portfolios belonging to the authenticated user
  const rows = await prisma.portfolio.findMany({ 
    where: { userId: auth.userId },
    orderBy: { id: 'asc' } 
  });
  
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rl2 = rateLimitStandard(auth.userId);
  if (rl2) return rl2;
  
  const { name } = await req.json();
  if (!name || typeof name !== 'string') return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
  
  const created = await prisma.portfolio.create({ 
    data: { 
      name,
      userId: auth.userId 
    } 
  });
  return NextResponse.json(created, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rl3 = rateLimitStandard(auth.userId);
  if (rl3) return rl3;
  
  const { id, name } = await req.json();
  const pid = Number(id);
  if (!Number.isFinite(pid) || !name) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  
  // Ensure user can only update their own portfolios
  const portfolio = await prisma.portfolio.findFirst({ where: { id: pid, userId: auth.userId } });
  if (!portfolio) return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 });
  
  const updated = await prisma.portfolio.update({ where: { id: pid }, data: { name } });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rl4 = rateLimitStandard(auth.userId);
  if (rl4) return rl4;
  
  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  
  // Ensure user can only delete their own portfolios
  const portfolio = await prisma.portfolio.findFirst({ where: { id, userId: auth.userId } });
  if (!portfolio) return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 });
  
  await prisma.portfolio.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}


