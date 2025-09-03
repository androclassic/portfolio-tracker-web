import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const portfolioId = Number(url.searchParams.get('portfolioId') || '1');
  const format = (url.searchParams.get('format') || 'default').toLowerCase();
  const where: Prisma.TransactionWhereInput = Number.isFinite(portfolioId) ? { portfolioId } : {};
  const rows = await prisma.transaction.findMany({ where, orderBy: { datetime: 'asc' } });
  let lines: string[] = [];
  if (format === 'tradingview') {
    // TradingView header: Symbol,Side,Qty,Fill Price,Commission,Closing Time
    lines = ['Symbol,Side,Qty,Fill Price,Commission,Closing Time'];
    for (const r of rows) {
      const symbol = r.asset.toUpperCase() === 'USD' ? '$CASH' : `${r.asset.toUpperCase()}USD`;
      const side = r.type;
      const qty = Math.abs(r.quantity);
      const fill = (r.type === 'Buy' || r.type === 'Sell') ? (r.priceUsd ?? '') : '';
      const comm = r.feesUsd ?? '';
      const ts = new Date(r.datetime).toISOString().replace('T',' ').slice(0,19);
      const vals = [symbol, side, qty, fill, comm, ts];
      const line = vals.map(v => typeof v === 'string' ? `"${String(v).replace(/"/g,'""')}"` : String(v)).join(',');
      lines.push(line);
    }
  } else {
    const header = ['id','asset','type','price_usd','quantity','datetime','fees_usd','cost_usd','proceeds_usd','notes'];
    lines = [header.join(',')];
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
        (r.notes || '').replace(/\"/g,'\"\"'),
      ];
      const line = vals.map(v => typeof v === 'string' ? `"${v}"` : String(v)).join(',');
      lines.push(line);
    }
  }
  const csv = lines.join('\n');
  return new NextResponse(csv, { 
    headers: { 
      'Content-Type': 'text/csv; charset=utf-8', 
      'Content-Disposition': `attachment; filename="transactions_portfolio_${portfolioId}${format==='tradingview' ? '_tradingview' : ''}.csv"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    } 
  });
}


