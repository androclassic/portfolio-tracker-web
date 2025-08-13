import { NextRequest, NextResponse } from 'next/server';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me';
const COOKIE_NAME = 'auth';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type AuthTokenPayload = { userId: number; email: string };

export function signAuthToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: MAX_AGE_SECONDS });
}

export function verifyAuthToken(token: string): AuthTokenPayload | null {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
    return payload;
  } catch (error) {
    console.log('🔥 JWT VERIFICATION FAILED:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      tokenStart: token?.substring(0, 20),
      jwtSecret: JWT_SECRET?.substring(0, 10) + '...'
    });
    return null;
  }
}

export function setAuthCookie(res: NextResponse, token: string) {
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_SECONDS,
    path: '/',
  });
}

export function clearAuthCookie(res: NextResponse) {
  res.cookies.set(COOKIE_NAME, '', { httpOnly: true, maxAge: 0, path: '/' });
}

export function getAuthFromRequest(req: NextRequest): AuthTokenPayload | null {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyAuthToken(token);
}


