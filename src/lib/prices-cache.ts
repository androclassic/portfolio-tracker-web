import type { HistResp, PricePoint } from './types';

const TTL_MS = 12 * 60 * 60 * 1000; // 12h

type CacheObj = { expiresAt: number; prices: PricePoint[] };

function readCache(key: string): PricePoint[] | null {
  try {
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
    const payload: CacheObj = { expiresAt: Date.now() + TTL_MS, prices };
    localStorage.setItem(key, JSON.stringify(payload));
  } catch {}
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

export async function fetchHistoricalWithLocalCache(symbols: string[], startUnixSec: number, endUnixSec: number): Promise<HistResp> {
  const chunks = chunkIntoThreeMonthRanges(startUnixSec, endUnixSec);
  const all: PricePoint[] = [];
  const symKey = symbols.slice().sort().join(',');

  for (const ch of chunks) {
    const key = `hist:${symKey}:${ch.s}:${ch.e}`;
    const cached = readCache(key);
    if (cached) {
      all.push(...cached);
      continue;
    }
    const url = `/api/prices?symbols=${encodeURIComponent(symKey)}&start=${ch.s}&end=${ch.e}`;
    const resp = await fetch(url);
    if (!resp.ok) continue;
    const json = (await resp.json()) as HistResp;
    const arr = (json?.prices || []) as PricePoint[];
    // store and append
    writeCache(key, arr);
    all.push(...arr);
  }

  // dedupe and sort
  const map = new Map<string, PricePoint>();
  for (const p of all) {
    const k = `${p.date}|${p.asset.toUpperCase()}`;
    if (!map.has(k)) map.set(k, p);
  }
  const merged = Array.from(map.values()).sort((a,b)=> a.date.localeCompare(b.date) || a.asset.localeCompare(b.asset));
  return { prices: merged };
}

export function clearHistCaches() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('hist:')) {
        localStorage.removeItem(k);
      }
    }
  } catch {}
}


