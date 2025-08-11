import { NextRequest, NextResponse } from 'next/server';
import { getCurrentPrices } from '@/lib/prices/service';

export async function GET(req: NextRequest){
  const url = new URL(req.url);
  const symbols = (url.searchParams.get('symbols')||'')
    .split(',')
    .map(s=>s.trim().toUpperCase())
    .filter(Boolean);
  if (!symbols.length) return NextResponse.json({ prices: {} }, { headers: { 'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=60' } });

  const prices = await getCurrentPrices(symbols);
  return NextResponse.json(
    { prices },
    { headers: { 'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=60' } }
  );
}
