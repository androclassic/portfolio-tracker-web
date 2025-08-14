import { NextRequest, NextResponse } from 'next/server';
import { clearAuthCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const to = url.searchParams.get('redirect') || '/login';
  
  // Create redirect URL preserving the original protocol and host
  const redirectUrl = new URL(to, req.url);
  
  // Only force HTTP for localhost development, preserve HTTPS for production domains
  if (redirectUrl.hostname === 'localhost' && redirectUrl.protocol === 'https:') {
    redirectUrl.protocol = 'http:';
  }
  
  const res = NextResponse.redirect(redirectUrl);
  clearAuthCookie(res);
  return res;
}


