import { NextRequest, NextResponse } from 'next/server';
import { validateApiKey } from '@/lib/api-key';
import { rateLimitTicker } from '@/lib/rate-limit';

interface TickerAuthOptions {
  missingApiKeyMessage?: string;
  invalidApiKeyMessage?: string;
}

export interface TickerAuthContext {
  userId: string;
}

/**
 * Shared auth/rate-limit gate for ticker endpoints.
 * Returns a NextResponse on auth failure, otherwise the resolved auth context.
 */
export async function authenticateTickerRequest(
  req: NextRequest,
  options: TickerAuthOptions = {},
): Promise<TickerAuthContext | NextResponse> {
  const limited = rateLimitTicker(req);
  if (limited) return limited;

  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) {
    return NextResponse.json(
      {
        error:
          options.missingApiKeyMessage ??
          'Unauthorized. Missing API key. Generate one from your account settings.',
      },
      { status: 401 },
    );
  }

  const { valid, userId } = await validateApiKey(apiKey);
  if (!valid || !userId) {
    return NextResponse.json(
      {
        error:
          options.invalidApiKeyMessage ??
          'Unauthorized. Invalid or expired API key.',
      },
      { status: 401 },
    );
  }

  return { userId };
}
