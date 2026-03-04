import { NextRequest } from 'next/server';
import { getServerAuth } from '@/lib/auth';
import { rateLimitStandard } from '@/lib/rate-limit';
import { apiUnauthorized } from '@/lib/api/responses';

export type ServerAuthContext = NonNullable<
  Awaited<ReturnType<typeof getServerAuth>>
>;

type AuthenticatedRouteHandler = (
  req: NextRequest,
  auth: ServerAuthContext,
) => Promise<Response> | Response;

/**
 * Wrap an API route handler to require authenticated user context.
 */
export function withServerAuth(
  handler: AuthenticatedRouteHandler,
) {
  return async function authWrappedHandler(req: NextRequest): Promise<Response> {
    const auth = await getServerAuth(req);
    if (!auth) {
      return apiUnauthorized();
    }
    return handler(req, auth);
  };
}

/**
 * Wrap an API route handler to require authentication and apply standard user rate limiting.
 */
export function withServerAuthRateLimit(
  handler: AuthenticatedRouteHandler,
) {
  return withServerAuth(async (req, auth) => {
    const limited = rateLimitStandard(auth.userId);
    if (limited) return limited;
    return handler(req, auth);
  });
}

type IpRateLimitedRouteHandler = (
  req: NextRequest,
  ip: string,
) => Promise<Response> | Response;

function getRequestIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * Wrap an API route handler with IP-based standard rate limiting.
 * Useful for public (unauthenticated) endpoints.
 */
export function withIpRateLimit(
  handler: IpRateLimitedRouteHandler,
) {
  return async function ipRateLimitedHandler(req: NextRequest): Promise<Response> {
    const ip = getRequestIp(req);
    const limited = rateLimitStandard(ip);
    if (limited) return limited;
    return handler(req, ip);
  };
}
