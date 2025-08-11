import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  // Ensure there is at least a Default and Personal portfolio
  const existing = await prisma.portfolio.findMany({ orderBy: { id: 'asc' } });
  if (existing.length === 0) {
    await prisma.portfolio.create({ data: { name: 'Default' } });
    await prisma.portfolio.create({ data: { name: 'Personal' } });
  }
  const rows = await prisma.portfolio.findMany({ orderBy: { id: 'asc' } });
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const { name } = await req.json();
  if (!name || typeof name !== 'string') return NextResponse.json({ error: 'Invalid name' }, { status: 400 });
  const created = await prisma.portfolio.create({ data: { name } });
  return NextResponse.json(created, { status: 201 });
}

export async function PUT(req: NextRequest) {
  const { id, name } = await req.json();
  const pid = Number(id);
  if (!Number.isFinite(pid) || !name) return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
  const updated = await prisma.portfolio.update({ where: { id: pid }, data: { name } });
  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest) {
  const url = new URL(req.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  await prisma.portfolio.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}


