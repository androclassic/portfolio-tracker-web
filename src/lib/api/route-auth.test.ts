import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getServerAuth: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({
  rateLimitStandard: vi.fn(),
}));

import { getServerAuth } from '@/lib/auth';
import { rateLimitStandard } from '@/lib/rate-limit';
import {
  withIpRateLimit,
  withServerAuthRateLimit,
} from '@/lib/api/route-auth';

const mockedGetServerAuth = vi.mocked(getServerAuth);
const mockedRateLimitStandard = vi.mocked(rateLimitStandard);

function makeRequest(url = 'http://localhost/api', headers?: Record<string, string>) {
  return new Request(url, { headers }) as unknown as NextRequest;
}

describe('route-auth wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when auth is missing', async () => {
    mockedGetServerAuth.mockResolvedValue(null);
    mockedRateLimitStandard.mockReturnValue(null);

    const handler = withServerAuthRateLimit(async () =>
      NextResponse.json({ ok: true }),
    );

    const res = await handler(makeRequest());
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('returns limiter response when standard limit is exceeded', async () => {
    mockedGetServerAuth.mockResolvedValue({
      userId: 'u_1',
      user: { id: 'u_1', email: 'a@b.com', name: null, image: null },
    });
    mockedRateLimitStandard.mockReturnValue(
      NextResponse.json({ error: 'Too many requests' }, { status: 429 }),
    );

    const handler = withServerAuthRateLimit(async () =>
      NextResponse.json({ ok: true }),
    );

    const res = await handler(makeRequest());
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: 'Too many requests' });
  });

  it('passes auth context to handler when authorized and not limited', async () => {
    mockedGetServerAuth.mockResolvedValue({
      userId: 'u_2',
      user: { id: 'u_2', email: 'c@d.com', name: 'Test', image: null },
    });
    mockedRateLimitStandard.mockReturnValue(null);

    const handler = withServerAuthRateLimit(async (_req, auth) =>
      NextResponse.json({ userId: auth.userId }),
    );

    const res = await handler(makeRequest());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ userId: 'u_2' });
  });

  it('extracts request IP for public endpoint limiter', async () => {
    mockedRateLimitStandard.mockReturnValue(null);

    const handler = withIpRateLimit(async (_req, ip) =>
      NextResponse.json({ ip }),
    );

    const res = await handler(
      makeRequest('http://localhost/public', { 'x-real-ip': '203.0.113.42' }),
    );

    expect(mockedRateLimitStandard).toHaveBeenCalledWith('203.0.113.42');
    await expect(res.json()).resolves.toEqual({ ip: '203.0.113.42' });
  });
});
