import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { calculateRomaniaTax } from '@/lib/tax/romania';
import { getHistoricalExchangeRate } from '@/lib/exchange-rates';
import type { TaxableEvent } from '@/lib/tax/romania';
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
    const eventId = searchParams.get('eventId'); // Optional: export specific event
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

    // Filter to specific event if requested
    let eventsToExport: TaxableEvent[] = taxReport.taxableEvents;
    if (eventId) {
      const event = taxReport.taxableEvents.find(e => e.transactionId === parseInt(eventId));
      if (!event) {
        return NextResponse.json({ error: 'Taxable event not found' }, { status: 404 });
      }
      eventsToExport = [event];
    }

    // Generate CSV
    const lines: string[] = [];
    
    // Header
    lines.push('Romanian Tax Report - Taxable Events');
    lines.push(`Year: ${year}`);
    lines.push(`Asset Lot Strategy: ${assetStrategy}`);
    lines.push(`Cash Lot Strategy: ${cashStrategy}`);
    lines.push(`USD to RON Exchange Rate: ${usdToRonRate.toFixed(4)}`);
    lines.push('');
    
    // Summary
    lines.push('Summary:');
    lines.push(`Total Withdrawals (USD),${taxReport.totalWithdrawalsUsd.toFixed(2)}`);
    lines.push(`Total Withdrawals (RON),${taxReport.totalWithdrawalsRon.toFixed(2)}`);
    lines.push(`Total Cost Basis (USD),${taxReport.totalCostBasisUsd.toFixed(2)}`);
    lines.push(`Total Cost Basis (RON),${taxReport.totalCostBasisRon.toFixed(2)}`);
    lines.push(`Total Gain/Loss (USD),${taxReport.totalGainLossUsd.toFixed(2)}`);
    lines.push(`Total Gain/Loss (RON),${taxReport.totalGainLossRon.toFixed(2)}`);
    lines.push('');
    
    // Taxable Events
    lines.push('Taxable Events:');
    lines.push('Event ID,Withdrawal Date,Withdrawal Amount (USD),Withdrawal Amount (RON),Cost Basis (USD),Cost Basis (RON),Gain/Loss (USD),Gain/Loss (RON)');
    
    eventsToExport.forEach(event => {
      const date = new Date(event.datetime).toISOString().split('T')[0];
      lines.push([
        event.transactionId,
        date,
        event.fiatAmountUsd.toFixed(2),
        event.fiatAmountRon.toFixed(2),
        event.costBasisUsd.toFixed(2),
        event.costBasisRon.toFixed(2),
        event.gainLossUsd.toFixed(2),
        event.gainLossRon.toFixed(2),
      ].join(','));
    });
    
    lines.push('');
    lines.push('Source Trace (Original Purchases / Buy Lots):');
    lines.push('Event ID,Buy Transaction ID,Asset,Quantity (From Lots),Allocated Cost Basis (USD),Allocated Cost Basis (RON),Buy Date,Price per Unit (USD)');
    
    eventsToExport.forEach(event => {
      event.sourceTrace.forEach(trace => {
        const buyDate = new Date(trace.datetime).toISOString().split('T')[0];
        const pricePerUnit = trace.pricePerUnitUsd || (trace.quantity > 0 ? trace.costBasisUsd / trace.quantity : 0);
        const costBasisRon = trace.costBasisUsd * usdToRonRate;
        
        lines.push([
          event.transactionId,
          trace.transactionId,
          trace.asset,
          trace.quantity.toFixed(8),
          trace.costBasisUsd.toFixed(2),
          costBasisRon.toFixed(2),
          buyDate,
          pricePerUnit.toFixed(6),
        ].join(','));
      });
    });

    lines.push('');
    lines.push('How you made the money (Sells funding the withdrawal):');
    lines.push('Event ID,Sell Transaction ID,Sell Date,Asset,Allocated Proceeds (USD),Allocated Cost Basis (USD),Allocated Gain/Loss (USD)');
    eventsToExport.forEach(event => {
      (event.saleTrace || []).forEach(sale => {
        const sellDate = new Date(sale.saleDatetime).toISOString().split('T')[0];
        lines.push([
          event.transactionId,
          sale.saleTransactionId,
          sellDate,
          sale.asset,
          sale.proceedsUsd.toFixed(2),
          sale.costBasisUsd.toFixed(2),
          sale.gainLossUsd.toFixed(2),
        ].join(','));
      });
    });

    lines.push('');
    lines.push('Underlying buy lots (what you bought that was later sold to fund the withdrawal):');
    lines.push('Event ID,Sell Transaction ID,Buy Transaction ID,Buy Date,Asset,Quantity (Sold From Lot),Allocated Cost Basis (USD)');
    eventsToExport.forEach(event => {
      (event.saleTrace || []).forEach(sale => {
        sale.buyLots.forEach(lot => {
          const buyDate = new Date(lot.buyDatetime).toISOString().split('T')[0];
          lines.push([
            event.transactionId,
            sale.saleTransactionId,
            lot.buyTransactionId,
            buyDate,
            lot.asset,
            lot.quantity.toFixed(8),
            lot.costBasisUsd.toFixed(2),
          ].join(','));
        });
      });
    });

    lines.push('');
    lines.push('Funding sells per buy lot (asset-to-asset hops):');
    lines.push('Event ID,Sell Transaction ID,Buy Transaction ID,Buy Asset,Funding Sell Tx,Funding Sell Date,Funding Sell Asset,Amount Used (USD)');
    eventsToExport.forEach(event => {
      (event.saleTrace || []).forEach(sale => {
        sale.buyLots.forEach(lot => {
          const fundingSells = (lot as unknown as { fundingSells?: Array<{ saleTransactionId: number; saleDatetime: string; asset: string; amountUsd: number }> }).fundingSells || [];
          fundingSells.forEach(fs => {
            const fsDate = new Date(fs.saleDatetime).toISOString().split('T')[0];
            lines.push([
              event.transactionId,
              sale.saleTransactionId,
              lot.buyTransactionId,
              lot.asset,
              fs.saleTransactionId,
              fsDate,
              fs.asset,
              (fs.amountUsd || 0).toFixed(2),
            ].join(','));
          });
        });
      });
    });

    lines.push('');
    lines.push('Buy lot funding deposits (how each buy was funded):');
    lines.push('Event ID,Sell Transaction ID,Buy Transaction ID,Deposit Transaction ID,Deposit Date,Deposit Currency,Deposit Amount (Original),Allocated Cost Basis (USD),Allocated Cost Basis (RON),FX Rate (USD per 1 unit)');
    eventsToExport.forEach(event => {
      (event.saleTrace || []).forEach(sale => {
        sale.buyLots.forEach(lot => {
          (lot.fundingDeposits || []).forEach(dep => {
            const depDate = new Date(dep.datetime).toISOString().split('T')[0];
            const fx = dep.exchangeRateAtPurchase ?? dep.pricePerUnitUsd ?? 1;
            const costBasisRon = dep.costBasisUsd * usdToRonRate;
            lines.push([
              event.transactionId,
              sale.saleTransactionId,
              lot.buyTransactionId,
              dep.transactionId,
              depDate,
              dep.asset,
              dep.quantity.toFixed(8),
              dep.costBasisUsd.toFixed(2),
              costBasisRon.toFixed(2),
              Number(fx).toFixed(6),
            ].join(','));
          });
        });
      });
    });

    // Optional: deposit trace at withdrawal level (can be huge)
    lines.push('');
    lines.push('Deposit Trace (deep; can be large):');
    lines.push('Event ID,Deposit Transaction ID,Deposit Date,Deposit Currency,Deposit Amount (Original),Allocated Cost Basis (USD),Allocated Cost Basis (RON),FX Rate (USD per 1 unit)');
    eventsToExport.forEach(event => {
      (event.depositTrace || []).forEach(dep => {
        const depDate = new Date(dep.datetime).toISOString().split('T')[0];
        const fx = dep.exchangeRateAtPurchase ?? dep.pricePerUnitUsd ?? 1;
        const costBasisRon = dep.costBasisUsd * usdToRonRate;
        lines.push([
          event.transactionId,
          dep.transactionId,
          depDate,
          dep.asset,
          dep.quantity.toFixed(8),
          dep.costBasisUsd.toFixed(2),
          costBasisRon.toFixed(2),
          Number(fx).toFixed(6),
        ].join(','));
      });
    });

    const csv = lines.join('\n');
    const filename = eventId 
      ? `romania_tax_event_${eventId}_${year}.csv`
      : `romania_tax_report_${year}.csv`;

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });
  } catch (error) {
    console.error('Romania tax export error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

