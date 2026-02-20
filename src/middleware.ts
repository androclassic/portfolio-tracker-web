import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

// Simple JWT verification for Edge Runtime (without Node.js crypto)
function verifyJWTInEdge(token: string): boolean {
  try {
    // Basic JWT structure validation
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    
    // Decode payload (without signature verification for now)
    const payload = JSON.parse(atob(parts[1]));
    
    // Check if token is expired
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      console.log('🔥 JWT EXPIRED:', { exp: payload.exp, now: Math.floor(Date.now() / 1000) });
      return false;
    }
    
    // Check if token has required fields
    if (!payload.userId) {
      console.log('🔥 JWT MISSING USERID');
      return false;
    }
    
    return true;
  } catch (error) {
    console.log('🔥 JWT PARSE ERROR:', error instanceof Error ? error.message : 'Unknown');
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  
  // Allow public assets
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/public')
  ) {
    return NextResponse.next();
  }

  // Allow the landing page to be public
  if (pathname === '/') {
    return NextResponse.next();
  }
  
  const token = req.cookies.get('auth')?.value;
  const isValidToken = token ? verifyJWTInEdge(token) : false;
  
  // Validate NextAuth session (prevents stale cookie issues)
  const nextAuthJwt = await getToken({ req, secureCookie: true });
  const hasValidNextAuthSession = !!nextAuthJwt;

  // If user hits login/register while already authenticated via NextAuth or JWT → send to overview
  if ((pathname === '/login' || pathname === '/register') && (isValidToken || hasValidNextAuthSession)) {
    const url = req.nextUrl.clone();
    url.pathname = '/overview';
    return NextResponse.redirect(url);
  }

  if (!isValidToken && !hasValidNextAuthSession && pathname !== '/login' && pathname !== '/register') {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|login|register).*)',
  ],
};


