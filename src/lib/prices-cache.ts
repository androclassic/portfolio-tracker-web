import type { HistResp, PricePoint } from './types';

const TTL_MS = 24 * 60 * 60 * 1000; // 24h (increased from 12h)
const HIST_CACHE_VERSION = 'v3'; // Increment when cache format changes

type CacheObj = { expiresAt: number; prices: PricePoint[] };

function readCache(key: string): PricePoint[] | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const obj = JSON.parse(raw) as CacheObj;
    if (!obj || typeof obj.expiresAt !== 'number' || Date.now() > obj.expiresAt) return null;
    return Array.isArray(obj.prices) ? (obj.prices as PricePoint[]) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, prices: PricePoint[]) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const payload: CacheObj = { expiresAt: Date.now() + TTL_MS, prices };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // localStorage might be full or disabled
  }
}

function chunkIntoThreeMonthRanges(startSec: number, endSec: number): Array<{ s: number; e: number }> {
  const out: Array<{ s: number; e: number }> = [];
  let s = new Date(startSec * 1000);
  const endMs = endSec * 1000;
  while (s.getTime() < endMs) {
    const e = new Date(s.getTime());
    e.setMonth(e.getMonth() + 3);
    const ce = Math.min(e.getTime(), endMs);
    out.push({ s: Math.floor(s.getTime() / 1000), e: Math.floor(ce / 1000) });
    s = new Date(ce);
  }
  return out;
}

/**
 * Fetch historical prices with aggressive client-side caching
 * Uses localStorage to avoid HTTP requests on repeat visits
 * Fetches missing chunks in parallel for speed
 */
export async function fetchHistoricalWithLocalCache(
  symbols: string[],
  startUnixSec: number,
  endUnixSec: number
): Promise<HistResp> {
  const chunks = chunkIntoThreeMonthRanges(startUnixSec, endUnixSec);
  const all: PricePoint[] = [];
  const symKey = symbols.slice().sort().join(',');

  // Step 1: Check localStorage cache for all chunks
  const missingChunks: Array<{ s: number; e: number; key: string }> = [];
  for (const ch of chunks) {
    const key = `hist:${HIST_CACHE_VERSION}:${symKey}:${ch.s}:${ch.e}`;
    const cached = readCache(key);
    if (cached && cached.length > 0) {
      all.push(...cached);
    } else {
      missingChunks.push({ ...ch, key });
    }
  }

  // If we have all chunks cached, return immediately (fastest path)
  if (missingChunks.length === 0) {
    // Dedupe and sort
    const map = new Map<string, PricePoint>();
    for (const p of all) {
      const k = `${p.date}|${p.asset.toUpperCase()}`;
      if (!map.has(k)) map.set(k, p);
    }
    const merged = Array.from(map.values()).sort((a, b) => 
      a.date.localeCompare(b.date) || a.asset.localeCompare(b.asset)
    );
    return { prices: merged };
  }

  // Step 2: Fetch missing chunks in parallel (much faster than sequential)
  const fetchPromises = missingChunks.map(async ({ s, e, key }) => {
    try {
      const url = `/api/prices?symbols=${encodeURIComponent(symKey)}&start=${s}&end=${e}`;
      const resp = await fetch(url);
      if (!resp.ok) {
        return [];
      }
      const json = (await resp.json()) as HistResp;
      const arr = (json?.prices || []) as PricePoint[];
      
      // Store in localStorage cache immediately
      if (arr.length > 0) {
        writeCache(key, arr);
      }
      
      return arr;
    } catch {
      return [];
    }
  });

  // Wait for all parallel requests
  const fetchedArrays = await Promise.all(fetchPromises);
  for (const arr of fetchedArrays) {
    if (arr.length > 0) {
      all.push(...arr);
    }
  }

  // Step 3: Dedupe and sort final result
  const map = new Map<string, PricePoint>();
  for (const p of all) {
    const k = `${p.date}|${p.asset.toUpperCase()}`;
    if (!map.has(k)) map.set(k, p);
  }
  const merged = Array.from(map.values()).sort((a, b) => 
    a.date.localeCompare(b.date) || a.asset.localeCompare(b.asset)
  );
  
  return { prices: merged };
}

export function clearHistCaches() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('hist:')) {
        keys.push(k);
      }
    }
    keys.forEach(k => localStorage.removeItem(k));
  } catch {
    // Ignore errors
  }
}

