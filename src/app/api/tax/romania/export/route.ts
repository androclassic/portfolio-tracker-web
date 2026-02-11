import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { calculateRomaniaTax } from '@/lib/tax/romania-v2';
import { getHistoricalExchangeRate, preloadExchangeRates } from '@/lib/exchange-rates';
import type { TaxableEvent } from '@/lib/tax/romania-v2';
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
    // Optional: include deep trace/hierarchy sections (can be very large).
    // Default is false to keep the "full report" export fast and reliable.
    const includeTrace = (() => {
      const v = (searchParams.get('includeTrace') || '').toLowerCase();
      return v === '1' || v === 'true' || v === 'yes';
    })();
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
    }) as Array<{
      id: number;
      type: string;
      datetime: Date;
      feesUsd: number | null;
      notes: string | null;
      fromAsset: string | null;
      fromQuantity: number | null;
      fromPriceUsd: number | null;
      toAsset: string;
      toQuantity: number;
      toPriceUsd: number | null;
      portfolioId: number;
      createdAt: Date;
      updatedAt: Date;
    }>;

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
    // If the year hasn't ended yet, use today's date instead
    const today = new Date();
    const yearEndDate = `${year}-12-31`;
    const targetDate = new Date(yearEndDate) > today ? today.toISOString().slice(0, 10) : yearEndDate;
    const usdToRonRate = await getHistoricalExchangeRate('USD', 'RON', targetDate);

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

    // Create a map of transaction ID -> transaction for quick lookup
    const txMap = new Map<number, typeof transactions[0]>();
    transactions.forEach(tx => {
      txMap.set(tx.id, tx);
    });

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
    lines.push('Event ID,Withdrawal Date,Withdrawal Currency,Withdrawal Amount (Original),FX (Fiat→USD),FX (Fiat→RON),FX (USD→RON),Withdrawal Amount (USD),Withdrawal Amount (RON),Cost Basis (USD),Cost Basis (RON),Gain/Loss (USD),Gain/Loss (RON)');
    
    eventsToExport.forEach(event => {
      const date = new Date(event.datetime).toISOString().split('T')[0];
      lines.push([
        event.transactionId,
        date,
        event.fiatCurrency,
        event.fiatAmountOriginal.toFixed(8),
        event.fxFiatToUsd.toFixed(6),
        event.fxFiatToRon.toFixed(6),
        event.fxUsdToRon.toFixed(6),
        event.fiatAmountUsd.toFixed(2),
        event.fiatAmountRon.toFixed(2),
        event.costBasisUsd.toFixed(2),
        event.costBasisRon.toFixed(2),
        event.gainLossUsd.toFixed(2),
        event.gainLossRon.toFixed(2),
      ].join(','));
    });

    // For each event, collect all implicated transactions and build hierarchy.
    // This is intentionally gated because it can explode output size and CPU.
    const shouldIncludeTrace = Boolean(eventId) || includeTrace;
    if (shouldIncludeTrace) eventsToExport.forEach(event => {
      // Collect all unique transaction IDs involved in this event
      const implicatedTxIds = new Set<number>();
      const hierarchyRelations: Array<{
        parentId: number;
        childId: number;
        relationshipType: string;
        level: number;
        amountAllocatedUsd?: number;
        costBasisAllocatedUsd?: number;
        quantity?: number;
      }> = [];

      // Add withdrawal transaction
      implicatedTxIds.add(event.transactionId);

      // Use saleTraceDeep for full hierarchy, fallback to saleTrace
      const sales = (event.saleTraceDeep && event.saleTraceDeep.length ? event.saleTraceDeep : (event.saleTrace || []));
      
      // Track which sales have been added to hierarchy (to avoid duplicate parent-child entries)
      const salesInHierarchy = new Set<number>();
      
      // Recursively collect all transactions and build hierarchy
      const processSale = (sale: typeof sales[0], parentId: number, level: number, addToHierarchy: boolean = true) => {
        implicatedTxIds.add(sale.saleTransactionId);
        
        // Add to hierarchy only if requested (first time we encounter this sale)
        if (addToHierarchy && !salesInHierarchy.has(sale.saleTransactionId)) {
          salesInHierarchy.add(sale.saleTransactionId);
          hierarchyRelations.push({
            parentId,
            childId: sale.saleTransactionId,
            relationshipType: level === 1 ? 'Withdrawal→Sale' : 'BuyLot→FundingSale',
            level,
            amountAllocatedUsd: sale.proceedsUsd,
            costBasisAllocatedUsd: sale.costBasisUsd,
          });
        }

        sale.buyLots.forEach(lot => {
          implicatedTxIds.add(lot.buyTransactionId);
          hierarchyRelations.push({
            parentId: sale.saleTransactionId,
            childId: lot.buyTransactionId,
            relationshipType: 'Sale→BuyLot',
            level: level + 1,
            costBasisAllocatedUsd: lot.costBasisUsd,
            quantity: lot.quantity,
          });

          // Handle funding deposits
          (lot.fundingDeposits || []).forEach(dep => {
            implicatedTxIds.add(dep.transactionId);
            hierarchyRelations.push({
              parentId: lot.buyTransactionId,
              childId: dep.transactionId,
              relationshipType: 'BuyLot→Deposit',
              level: level + 2,
              amountAllocatedUsd: dep.costBasisUsd,
              costBasisAllocatedUsd: dep.costBasisUsd,
            });
          });

          // Handle funding sells (recursive)
          const fundingSells = (lot as unknown as { fundingSells?: Array<{ saleTransactionId: number; saleDatetime: string; asset: string; amountUsd: number; costBasisUsd?: number }> }).fundingSells || [];
          fundingSells.forEach(fs => {
            implicatedTxIds.add(fs.saleTransactionId);
            hierarchyRelations.push({
              parentId: lot.buyTransactionId,
              childId: fs.saleTransactionId,
              relationshipType: 'BuyLot→FundingSale',
              level: level + 2,
              amountAllocatedUsd: fs.amountUsd,
              costBasisAllocatedUsd: fs.costBasisUsd || 0,
            });

            // Recursively process funding sell to add its buy lots
            // Don't add the sale to hierarchy again (already added above)
            const fundingSale = sales.find(s => s.saleTransactionId === fs.saleTransactionId);
            if (fundingSale) {
              processSale(fundingSale, fs.saleTransactionId, level + 2, false);
            }
          });

          // Handle crypto swaps (swappedFromTransactionId)
          if (lot.swappedFromTransactionId) {
            implicatedTxIds.add(lot.swappedFromTransactionId);
            hierarchyRelations.push({
              parentId: lot.buyTransactionId,
              childId: lot.swappedFromTransactionId,
              relationshipType: 'BuyLot→SwapFrom',
              level: level + 2,
              quantity: lot.swappedFromQuantity,
            });
          }

          // Handle swapped from buy lots (for crypto-to-crypto swaps)
          if (lot.swappedFromBuyLots && lot.swappedFromBuyLots.length > 0) {
            lot.swappedFromBuyLots.forEach(originalLot => {
              implicatedTxIds.add(originalLot.buyTransactionId);
              hierarchyRelations.push({
                parentId: lot.buyTransactionId,
                childId: originalLot.buyTransactionId,
                relationshipType: 'BuyLot→OriginalBuyLot',
                level: level + 2,
                costBasisAllocatedUsd: originalLot.costBasisUsd,
                quantity: originalLot.quantity,
              });
            });
          }
        });
      };

      // Process all direct sales (those that directly fund the withdrawal)
      sales.forEach(sale => {
        processSale(sale, event.transactionId, 1, true);
      });

      // Add deposits from depositTrace
      (event.depositTrace || []).forEach(dep => {
        implicatedTxIds.add(dep.transactionId);
      });

      // === ALL IMPLICATED TRANSACTIONS ===
      lines.push('');
      lines.push(`=== ALL IMPLICATED TRANSACTIONS (Event ${event.transactionId}) ===`);
      lines.push('This section lists all unique transactions involved in this tax event.');
      lines.push('Each transaction appears once with complete details.');
      lines.push('');
      lines.push('Transaction ID,Type,Date,From Asset,From Quantity,From Price USD,To Asset,To Quantity,To Price USD,Fees USD,Notes');
      
      // Sort transaction IDs for consistent output
      const sortedTxIds = Array.from(implicatedTxIds).sort((a, b) => a - b);
      sortedTxIds.forEach(txId => {
        const tx = txMap.get(txId);
        if (tx) {
          const date = new Date(tx.datetime).toISOString().split('T')[0];
          const notes = (tx.notes || '').replace(/"/g, '""'); // Escape quotes for CSV
          lines.push([
            tx.id,
            tx.type,
            date,
            tx.fromAsset || '',
            tx.fromQuantity?.toFixed(8) || '',
            tx.fromPriceUsd?.toFixed(6) || '',
            tx.toAsset,
            tx.toQuantity.toFixed(8),
            tx.toPriceUsd?.toFixed(6) || '',
            tx.feesUsd?.toFixed(2) || '',
            `"${notes}"`,
          ].join(','));
        }
      });

      // === TRANSACTION HIERARCHY ===
      lines.push('');
      lines.push(`=== TRANSACTION HIERARCHY (Event ${event.transactionId}) ===`);
      lines.push('This section shows the parent-child relationships between transactions.');
      lines.push('Use this to trace how cost basis flows from deposits through buys and sales to the withdrawal.');
      lines.push('');
      lines.push('Parent Transaction ID,Child Transaction ID,Relationship Type,Level,Amount Allocated (USD),Cost Basis Allocated (USD),Quantity');
      
      // Sort hierarchy by level, then by parent ID
      hierarchyRelations.sort((a, b) => {
        if (a.level !== b.level) return a.level - b.level;
        if (a.parentId !== b.parentId) return a.parentId - b.parentId;
        return a.childId - b.childId;
      });

      hierarchyRelations.forEach(rel => {
        lines.push([
          rel.parentId,
          rel.childId,
          rel.relationshipType,
          rel.level,
          rel.amountAllocatedUsd?.toFixed(2) || '',
          rel.costBasisAllocatedUsd?.toFixed(2) || '',
          rel.quantity?.toFixed(8) || '',
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
      { error: (error as Error)?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

