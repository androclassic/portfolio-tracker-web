import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';

export async function POST(req: NextRequest) {
  const { username, password, passwordHash } = await req.json();
  if (!username || (!password && !passwordHash)) return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) return NextResponse.json({ error: 'User already exists' }, { status: 400 });
  
  // Handle both legacy plain text passwords and new client-side hashed passwords
  let finalPasswordHash: string;
  if (passwordHash) {
    // Client sent SHA-256 hash, hash it with bcrypt for storage
    finalPasswordHash = await bcrypt.hash(passwordHash, 10);
  } else {
    // Legacy: client sent plain text password, hash it once
    finalPasswordHash = await bcrypt.hash(password, 10);
  }
  
  const created = await prisma.user.create({ data: { username, passwordHash: finalPasswordHash } });
  return NextResponse.json({ ok: true, userId: created.id });
}


