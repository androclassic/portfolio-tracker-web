import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const portfolioId = Number(url.searchParams.get('portfolioId') || '1');
  const where: Prisma.TransactionWhereInput = Number.isFinite(portfolioId) ? { portfolioId } : {};
  const rows = await prisma.transaction.findMany({ where, orderBy: { datetime: 'asc' } });
  
  const header = ['id','type','datetime','from_asset','from_quantity','from_price_usd','to_asset','to_quantity','to_price_usd','fees_usd','notes'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const vals = [
      r.id,
      r.type,
      new Date(r.datetime).toISOString(),
      r.fromAsset ?? '',
      r.fromQuantity ?? '',
      r.fromPriceUsd ?? '',
      r.toAsset,
      r.toQuantity,
      r.toPriceUsd ?? '',
      r.feesUsd ?? '',
      (r.notes || '').replace(/\"/g,'\"\"'),
    ];
    const line = vals.map(v => typeof v === 'string' ? `"${v}"` : String(v)).join(',');
    lines.push(line);
  }
  const csv = lines.join('\n');
  return new NextResponse(csv, { 
    headers: { 
      'Content-Type': 'text/csv; charset=utf-8', 
      'Content-Disposition': `attachment; filename="transactions_portfolio_${portfolioId}.csv"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    } 
  });
}


