import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth';
import { rateLimitStandard } from '@/lib/rate-limit';

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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
