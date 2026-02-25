import { NextRequest, NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  
  // Allow public assets (Next serves `public/` at the site root, e.g. `/ticker-showcase.jpeg`)
  // Also allow any request that looks like a static file (has an extension).
  const isStaticFile = /\.[a-zA-Z0-9]+$/.test(pathname);
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/public') ||
    isStaticFile
  ) {
    return NextResponse.next();
  }

  // Allow the landing page to be public
  if (pathname === '/') {
    return NextResponse.next();
  }
  
  // Validate NextAuth session via cryptographically-verified JWT
  const nextAuthJwt = await getToken({ req, secureCookie: process.env.NODE_ENV === 'production' });
  const isAuthenticated = !!nextAuthJwt;

  // If user hits login/register while already authenticated → send to overview
  if ((pathname === '/login' || pathname === '/register') && isAuthenticated) {
    const url = req.nextUrl.clone();
    url.pathname = '/overview';
    return NextResponse.redirect(url);
  }

  if (!isAuthenticated && pathname !== '/login' && pathname !== '/register') {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Exclude API, Next internals, auth pages, and all static files (e.g. `/image.png`, `/robots.txt`)
    '/((?!api|_next/static|_next/image|favicon.ico|login|register|.*\\..*).*)',
  ],
};
