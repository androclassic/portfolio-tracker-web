import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { calculateRomaniaTax } from '@/lib/tax/romania-v2';
import { getHistoricalExchangeRate, preloadExchangeRates } from '@/lib/exchange-rates';
import type { LotStrategy } from '@/lib/tax/lot-strategy';
import { withServerAuthRateLimit } from '@/lib/api/route-auth';
import { createLogger } from '@/lib/logger';
import { apiServerError } from '@/lib/api/responses';

const log = createLogger('Tax');

export const GET = withServerAuthRateLimit(async (req: NextRequest, auth) => {
  try {
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
        userId: auth.userId,
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
    // If the year hasn't ended yet, use today's date instead
    const today = new Date();
    const yearEndDate = `${year}-12-31`;
    const targetDate = new Date(yearEndDate) > today ? today.toISOString().slice(0, 10) : yearEndDate;
    const usdToRonRate = await getHistoricalExchangeRate('USD', 'RON', targetDate);

    // Calculate tax report
    const taxReport = calculateRomaniaTax(txs, year, usdToRonRate, { assetStrategy, cashStrategy });

    return NextResponse.json(taxReport, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    log.error('Romania tax calculation error', error);
    return apiServerError(error);
  }
});

