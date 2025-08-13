import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  const row = await prisma.verificationToken.findUnique({ where: { token } });
  if (!row) return NextResponse.json({ error: 'Invalid token' }, { status: 400 });
  if (row.expiresAt < new Date()) return NextResponse.json({ error: 'Token expired' }, { status: 400 });
  await prisma.user.update({ where: { email: row.email }, data: { emailVerified: new Date() } });
  await prisma.verificationToken.delete({ where: { token } });
  return NextResponse.json({ ok: true });
}


