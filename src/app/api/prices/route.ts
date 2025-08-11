import { NextRequest, NextResponse } from 'next/server';
import { getHistoricalPrices } from '@/lib/prices/service';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const symbols = (url.searchParams.get('symbols')||'').split(',').map(s=>s.trim().toUpperCase()).filter(Boolean);
  const start = Number(url.searchParams.get('start'));
  const end = Number(url.searchParams.get('end'));
  if (!symbols.length || !Number.isFinite(start) || !Number.isFinite(end)) return NextResponse.json({ prices: [] }, { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600' } });

  const prices = await getHistoricalPrices(symbols, Math.floor(start), Math.floor(end));
  return NextResponse.json(
    { prices },
    { headers: { 'Cache-Control': 'public, max-age=300, s-maxage=300, stale-while-revalidate=600' } }
  );
}
