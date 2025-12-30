import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { calculateRomaniaTax } from '@/lib/tax/romania';
import { getHistoricalExchangeRate } from '@/lib/exchange-rates';
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

    // Convert to Transaction type
    const txs = transactions.map((tx) => ({
      id: tx.id,
      asset: tx.asset,
      type: tx.type as 'Buy' | 'Sell' | 'Deposit' | 'Withdrawal',
      priceUsd: tx.priceUsd,
      quantity: tx.quantity,
      datetime: tx.datetime.toISOString(),
      costUsd: tx.costUsd,
      proceedsUsd: tx.proceedsUsd,
      notes: tx.notes,
      portfolioId: tx.portfolioId,
    }));

    // Get USD to RON exchange rate for the year
    // Use the average rate for the year, or the rate at year-end
    const yearEndDate = `${year}-12-31`;
    let usdToRonRate = 4.5; // Default fallback

    try {
      const rate = await getHistoricalExchangeRate('USD', 'RON', yearEndDate);
      if (rate && rate > 0) {
        usdToRonRate = rate;
      }
    } catch (error) {
      console.warn('Failed to fetch USD/RON rate, using default:', error);
    }

    // Calculate tax report
    const taxReport = calculateRomaniaTax(txs, year, usdToRonRate, { assetStrategy, cashStrategy });

    return NextResponse.json(taxReport);
  } catch (error) {
    console.error('Romania tax calculation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

