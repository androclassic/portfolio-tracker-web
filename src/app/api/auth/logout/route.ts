import { NextRequest, NextResponse } from 'next/server';
import { clearAuthCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const to = url.searchParams.get('redirect') || '/login';
  const res = NextResponse.redirect(new URL(to, req.url));
  clearAuthCookie(res);
  return res;
}


