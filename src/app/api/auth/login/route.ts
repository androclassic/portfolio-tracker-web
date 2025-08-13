import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { signAuthToken, setAuthCookie } from '@/lib/auth';

export async function GET() {
  return NextResponse.json({ ok: false, message: 'Use POST with JSON { email, password }' });
}

export async function POST(req: NextRequest) {
  const { username, email, password, passwordHash } = await req.json();
  if ((!username && !email) || (!password && !passwordHash)) return NextResponse.json({ error: 'Username (or email) and password are required' }, { status: 400 });
  const user = username
    ? await prisma.user.findUnique({ where: { username } })
    : await prisma.user.findUnique({ where: { email } });
  if (!user) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  
  // Handle both legacy plain text passwords and new client-side hashed passwords
  let ok = false;
  if (passwordHash) {
    // Client sent SHA-256 hash, compare using bcrypt against stored bcrypt(SHA256) hash
    ok = await bcrypt.compare(passwordHash, user.passwordHash);
  } else if (password) {
    // Legacy: client sent plain text password
    ok = await bcrypt.compare(password, user.passwordHash);
  }
  
  if (!ok) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  // Optionally require emailVerified
  // if (!user.emailVerified) return NextResponse.json({ error: 'Email not verified' }, { status: 403 });
  const token = signAuthToken({ userId: user.id, email: user.email || '' });
  const res = NextResponse.json({ ok: true });
  setAuthCookie(res, token);
  return res;
}


