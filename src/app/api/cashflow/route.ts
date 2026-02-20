import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { getServerAuth } from '@/lib/auth';
import { rateLimitStandard } from '@/lib/rate-limit';

export async function GET(req: NextRequest) {
  // Authenticate user
  const auth = await getServerAuth(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const rl = rateLimitStandard(auth.userId);
  if (rl) return rl;

  const url = new URL(req.url);
  const portfolioId = Number(url.searchParams.get('portfolioId') || '1');

  // Get all transactions for the portfolio
  const where: Prisma.TransactionWhereInput = Number.isFinite(portfolioId)
    ? { portfolioId }
    : { portfolio: { userId: auth.userId } };

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: { datetime: 'asc' },
  });

  // Map transactions → clear money flow categories
  // New schema: type (Deposit/Withdrawal/Swap), fromAsset/fromQuantity/fromPriceUsd, toAsset/toQuantity/toPriceUsd
  const moneyFlowData = transactions.map((tx) => {
    const date = new Date(tx.datetime);
    const year = date.getFullYear();
    const month = date.getMonth();
    const day = date.getDate();

    let bankDeposit = 0; // Money FROM bank TO platform (USD increases via deposit)
    let bankWithdrawal = 0; // Money FROM platform TO bank (USD decreases via withdrawal)
    let assetPurchase = 0; // Money spent buying crypto/assets (USD → asset)
    let assetSale = 0; // Money received selling crypto/assets (asset → USD)
    let isTaxableEvent = false; // Crypto sales are taxable events
    let assetFlow = '';

    const toAsset = tx.toAsset?.toUpperCase() || '';
    const fromAsset = tx.fromAsset?.toUpperCase() || '';
    const toValue = (tx.toQuantity || 0) * (tx.toPriceUsd || 0);
    const fromValue = (tx.fromQuantity || 0) * (tx.fromPriceUsd || 0);

    switch (tx.type) {
      case 'Deposit': {
        // Depositing assets (usually USD from bank)
        if (toAsset === 'USD') {
          bankDeposit = toValue || tx.toQuantity || 0;
          assetFlow = 'USD (Bank → Platform)';
        } else {
          // Depositing crypto (e.g., transfer in)
          assetFlow = `${toAsset} (External → Platform)`;
        }
        break;
      }
      case 'Withdrawal': {
        // Withdrawing assets (usually USD to bank)
        if (fromAsset === 'USD') {
          bankWithdrawal = fromValue || tx.fromQuantity || 0;
          assetFlow = 'USD (Platform → Bank)';
        } else {
          // Withdrawing crypto (e.g., transfer out)
          assetFlow = `${fromAsset} (Platform → External)`;
        }
        break;
      }
      case 'Swap': {
        // Swapping one asset for another
        if (fromAsset === 'USD') {
          // Buying crypto with USD
          assetPurchase = fromValue || tx.fromQuantity || 0;
          assetFlow = `${toAsset} (USD → ${toAsset})`;
        } else if (toAsset === 'USD') {
          // Selling crypto for USD
          assetSale = toValue || tx.toQuantity || 0;
          isTaxableEvent = true;
          assetFlow = `${fromAsset} (${fromAsset} → USD)`;
        } else {
          // Crypto to crypto swap - taxable event
          isTaxableEvent = true;
          assetFlow = `${fromAsset} → ${toAsset}`;
        }
        break;
      }
    }

    return {
      date: tx.datetime,
      year,
      month,
      day,
      bankDeposit,
      bankWithdrawal,
      assetPurchase,
      assetSale,
      isTaxableEvent,
      fromAsset: tx.fromAsset,
      toAsset: tx.toAsset,
      type: tx.type,
      fromQuantity: tx.fromQuantity,
      toQuantity: tx.toQuantity,
      fromPriceUsd: tx.fromPriceUsd,
      toPriceUsd: tx.toPriceUsd,
      feesUsd: tx.feesUsd,
      notes: tx.notes,
      assetFlow,
    };
  });

  // Group by day/month/year
  type Agg = {
    bankDeposit: number;
    bankWithdrawal: number;
    assetPurchase: number;
    assetSale: number;
    taxableEvents: number;
  };

  const dailyFlow = new Map<string, Agg>();
  const monthlyFlow = new Map<string, Agg>();
  const yearlyFlow = new Map<string, Agg>();

  function add(map: Map<string, Agg>, key: string, item: (typeof moneyFlowData)[number]) {
    if (!map.has(key)) {
      map.set(key, { bankDeposit: 0, bankWithdrawal: 0, assetPurchase: 0, assetSale: 0, taxableEvents: 0 });
    }
    const agg = map.get(key)!;
    agg.bankDeposit += item.bankDeposit;
    agg.bankWithdrawal += item.bankWithdrawal;
    agg.assetPurchase += item.assetPurchase;
    agg.assetSale += item.assetSale;
    if (item.isTaxableEvent) agg.taxableEvents += 1;
  }

  moneyFlowData.forEach((item) => {
    const dayKey = `${item.year}-${String(item.month + 1).padStart(2, '0')}-${String(item.day).padStart(2, '0')}`;
    const monthKey = `${item.year}-${String(item.month + 1).padStart(2, '0')}`;
    const yearKey = `${item.year}`;
    add(dailyFlow, dayKey, item);
    add(monthlyFlow, monthKey, item);
    add(yearlyFlow, yearKey, item);
  });

  // Cumulative series and summary
  let cumulativeBankDeposit = 0;
  let cumulativeBankWithdrawal = 0;
  let cumulativeAssetPurchase = 0;
  let cumulativeAssetSale = 0;
  let totalTaxableEvents = 0;

  const cumulativeData = moneyFlowData.map((item) => {
    cumulativeBankDeposit += item.bankDeposit;
    cumulativeBankWithdrawal += item.bankWithdrawal;
    cumulativeAssetPurchase += item.assetPurchase;
    cumulativeAssetSale += item.assetSale;
    if (item.isTaxableEvent) totalTaxableEvents += 1;

    return {
      ...item,
      cumulativeBankDeposit,
      cumulativeBankWithdrawal,
      cumulativeAssetPurchase,
      cumulativeAssetSale,
      netBankFlow: cumulativeBankDeposit - cumulativeBankWithdrawal,
      netAssetFlow: cumulativeAssetSale - cumulativeAssetPurchase,
      totalMoneyIn: cumulativeBankDeposit,
      totalMoneyOut: cumulativeBankWithdrawal + cumulativeAssetSale,
    };
  });

  const summary = {
    totalBankDeposits: cumulativeBankDeposit,
    totalBankWithdrawals: cumulativeBankWithdrawal,
    netBankFlow: cumulativeBankDeposit - cumulativeBankWithdrawal,

    totalAssetPurchases: cumulativeAssetPurchase,
    totalAssetSales: cumulativeAssetSale,
    netAssetTrading: cumulativeAssetSale - cumulativeAssetPurchase,

    totalMoneyIn: cumulativeBankDeposit,
    totalMoneyOut: cumulativeBankWithdrawal + cumulativeAssetSale,
    netMoneyFlow: cumulativeBankDeposit - (cumulativeBankWithdrawal + cumulativeAssetSale),

    totalTaxableEvents,
    totalTransactions: transactions.length,
    dateRange: {
      start: transactions[0]?.datetime || null,
      end: transactions[transactions.length - 1]?.datetime || null,
    },
  };

  return NextResponse.json({
    summary,
    dailyFlow: Object.fromEntries(dailyFlow),
    monthlyFlow: Object.fromEntries(monthlyFlow),
    yearlyFlow: Object.fromEntries(yearlyFlow),
    cumulativeData,
    rawData: moneyFlowData,
  });
}
