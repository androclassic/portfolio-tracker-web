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
      const ts = new Date(r.datetime).toISOString().replace('T',' ').slice(0,19);
      const comm = r.feesUsd ?? '';
      
      if (r.type === 'Swap' && r.fromAsset && r.fromQuantity && r.fromPriceUsd) {
        // Export Swap as two rows: Sell (from) and Buy (to)
        // Sell side
        const sellSymbol = r.fromAsset.toUpperCase() === 'USD' ? '$CASH' : `${r.fromAsset.toUpperCase()}USD`;
        const sellVals = [sellSymbol, 'Sell', Math.abs(r.fromQuantity), r.fromPriceUsd, comm, ts];
        lines.push(sellVals.map(v => typeof v === 'string' ? `"${String(v).replace(/"/g,'""')}"` : String(v)).join(','));
        
        // Buy side
        const buySymbol = r.toAsset.toUpperCase() === 'USD' ? '$CASH' : `${r.toAsset.toUpperCase()}USD`;
        const buyVals = [buySymbol, 'Buy', Math.abs(r.toQuantity), r.toPriceUsd ?? '', '', ts];
        lines.push(buyVals.map(v => typeof v === 'string' ? `"${String(v).replace(/"/g,'""')}"` : String(v)).join(','));
      } else {
        // Deposit or Withdrawal
        const symbol = r.toAsset.toUpperCase() === 'USD' ? '$CASH' : `${r.toAsset.toUpperCase()}USD`;
        const side = r.type;
        const qty = Math.abs(r.toQuantity);
        const fill = r.toPriceUsd ?? '';
        const vals = [symbol, side, qty, fill, comm, ts];
        const line = vals.map(v => typeof v === 'string' ? `"${String(v).replace(/"/g,'""')}"` : String(v)).join(',');
        lines.push(line);
      }
    }
  } else {
    const header = ['id','type','datetime','from_asset','from_quantity','from_price_usd','to_asset','to_quantity','to_price_usd','fees_usd','notes'];
    lines = [header.join(',')];
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


