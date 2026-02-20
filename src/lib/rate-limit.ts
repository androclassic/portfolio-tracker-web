import { NextRequest, NextResponse } from 'next/server';

/* ------------------------------------------------------------------ */
/*  In-memory sliding-window rate limiter                              */
/*  Works well for self-hosted single-process Next.js deployments.     */
/*  For multi-instance / serverless, swap the Map for Redis.           */
/* ------------------------------------------------------------------ */

interface WindowEntry {
  /** Timestamps (ms) of requests inside the current window */
  timestamps: number[];
}

const store = new Map<string, WindowEntry>();

// Periodic cleanup of expired entries (every 60 s)
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanup = Date.now();

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  const cutoff = now - windowMs * 2; // generous cutoff
  for (const [key, entry] of store) {
    // Remove entries whose newest timestamp is old
    if (entry.timestamps.length === 0 || entry.timestamps[entry.timestamps.length - 1] < cutoff) {
      store.delete(key);
    }
  }
}

/**
 * Core rate-limit check.
 * Returns `null` when allowed, or a 429 `NextResponse` when the limit is exceeded.
 */
function check(
  key: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  const now = Date.now();
  cleanup(windowMs);

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Drop timestamps outside the window
  const cutoff = now - windowMs;
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= limit) {
    const retryAfterSec = Math.ceil(
      (entry.timestamps[0] + windowMs - now) / 1000,
    );
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(retryAfterSec, 1)),
          'X-RateLimit-Limit': String(limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(
            Math.ceil((entry.timestamps[0] + windowMs) / 1000),
          ),
        },
      },
    );
  }

  entry.timestamps.push(now);
  return null; // allowed
}

/* ------------------------------------------------------------------ */
/*  Helpers to extract identity from a request                         */
/* ------------------------------------------------------------------ */

function getIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

/* ------------------------------------------------------------------ */
/*  Pre-configured rate-limit functions                                */
/* ------------------------------------------------------------------ */

/**
 * **Auth tier** – strict, IP-based.
 * 10 requests per 15 minutes.
 */
export function rateLimitAuth(req: NextRequest): NextResponse | null {
  const ip = getIp(req);
  return check(`auth:${ip}`, 10, 15 * 60 * 1000);
}

/**
 * **Ticker tier** – moderate, keyed by API key.
 * 60 requests per minute.
 */
export function rateLimitTicker(req: NextRequest): NextResponse | null {
  const apiKey = req.headers.get('x-api-key') || getIp(req);
  // Use first 16 chars to avoid storing full keys in memory
  const identifier = apiKey.substring(0, 16);
  return check(`ticker:${identifier}`, 60, 60 * 1000);
}

/**
 * **Standard tier** – authenticated endpoints, keyed by user ID.
 * 120 requests per minute.
 */
export function rateLimitStandard(userId: string): NextResponse | null {
  return check(`std:${userId}`, 120, 60 * 1000);
}
