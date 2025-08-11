import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const portfolioId = Number(url.searchParams.get('portfolioId') || '1');
  const rows = await prisma.transaction.findMany({ where: ({ ...(Number.isFinite(portfolioId)? { portfolioId } : {}) } as any), orderBy: { datetime: 'asc' } });
  const header = ['id','asset','type','price_usd','quantity','datetime','fees_usd','cost_usd','proceeds_usd','notes'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const vals = [
      r.id,
      r.asset,
      r.type,
      r.priceUsd ?? '',
      r.quantity,
      new Date(r.datetime).toISOString(),
      r.feesUsd ?? '',
      r.costUsd ?? '',
      r.proceedsUsd ?? '',
      (r.notes || '').replace(/"/g,'""'),
    ];
    const line = vals.map(v => typeof v === 'string' ? `"${v}"` : String(v)).join(',');
    lines.push(line);
  }
  const csv = lines.join('\n');
  return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="transactions_portfolio_${portfolioId}.csv"` } });
}


