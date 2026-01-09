import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { calculateRomaniaTax } from '@/lib/tax/romania-v2';
import { getHistoricalExchangeRate, preloadExchangeRates } from '@/lib/exchange-rates';
import type { LotStrategy } from '@/lib/tax/lot-strategy';

export async function GET(req: NextRequest) {
  try {
    // Authenticate user
    const auth = await getServerAuth(req);
    if (!auth?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get query parameters
    const { searchParams } = new URL(req.url);
    const year = searchParams.get('year') || new Date().getFullYear().toString();
    const portfolioId = searchParams.get('portfolioId');
    const parseStrategy = (value: string | null, fallback: LotStrategy): LotStrategy => {
      const s = (value || '').toUpperCase();
      return s === 'FIFO' || s === 'LIFO' || s === 'HIFO' || s === 'LOFO' ? (s as LotStrategy) : fallback;
    };
    const assetStrategy = parseStrategy(searchParams.get('assetStrategy'), 'FIFO');
    const cashStrategy = parseStrategy(searchParams.get('cashStrategy'), 'FIFO');

    // Fetch transactions
    const where: {
      portfolio: {
        userId: string;
      };
      portfolioId?: number;
    } = {
      portfolio: {
        userId: auth.user.id,
      },
    };

    if (portfolioId && portfolioId !== 'all') {
      where.portfolioId = parseInt(portfolioId);
    }

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: {
        datetime: 'asc',
      },
    });

    // Preload real historical FX rates for fiat-related dates only (strict tax mode)
    // Crypto buys/sells are already in USD (USDC) so they don't need FX.
    if (transactions.length) {
      const fiatAssets = new Set(['EUR', 'USD', 'RON']);
      const relevant = transactions.filter((t) => 
        fiatAssets.has(String(t.fromAsset || '').toUpperCase()) || 
        fiatAssets.has(String(t.toAsset || '').toUpperCase())
      );
      const list = relevant.length ? relevant : transactions;
      const start = list[0].datetime.toISOString().slice(0, 10);
      const end = list[list.length - 1].datetime.toISOString().slice(0, 10);
      await preloadExchangeRates(start, end);
    }

    // Convert to Transaction type (with datetime as ISO string)
    const txs = transactions.map((tx) => ({
      ...tx,
      type: tx.type as 'Deposit' | 'Withdrawal' | 'Swap',
      datetime: tx.datetime.toISOString(),
    }));

    // Get USD to RON exchange rate for the year
    // Use the average rate for the year, or the rate at year-end
    const yearEndDate = `${year}-12-31`;
    const usdToRonRate = await getHistoricalExchangeRate('USD', 'RON', yearEndDate);

    // Calculate tax report
    const taxReport = calculateRomaniaTax(txs, year, usdToRonRate, { assetStrategy, cashStrategy });

    return NextResponse.json(taxReport, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('Romania tax calculation error:', error);
    return NextResponse.json(
      { error: (error as Error)?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

