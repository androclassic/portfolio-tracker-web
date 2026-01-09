import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parse as parseCsv } from 'csv-parse/sync';
import { parse as parseDateFns, isValid as isValidDate } from 'date-fns';
import type { Prisma } from '@prisma/client';
import { validateAssetList, isFiatCurrency } from '@/lib/assets';
import { getServerAuth } from '@/lib/auth';

function parseFloatSafe(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim().replace(/[+$,]/g, '');
  if (s === '' || s.toLowerCase() === 'nan' || s.toLowerCase() === 'none') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeType(v: unknown): 'Buy' | 'Sell' | 'Deposit' | 'Withdrawal' | 'Swap' {
  const s = String(v || '').toLowerCase();
  if (s === 'swap') return 'Swap';
  if (s === 'sell') return 'Sell';
  if (s === 'deposit') return 'Deposit';
  if (s === 'withdrawal' || s === 'withdraw') return 'Withdrawal';
  return 'Buy';
}

function parseDateFlexible(input: unknown): Date | null {
  const raw = String(input || '').replace(/"/g, '').trim();
  if (!raw) return null;
  // Try native
  const native = new Date(raw);
  if (isValidDate(native)) return native;
  // Try common text formats used in seed
  const formats = [
    'dd MMM yyyy, h:mma',
    'dd MMM yyyy, h:mm a',
    'dd LLL yyyy, h:mma',
    'dd LLL yyyy, h:mm a',
    'dd MMM yyyy, H:mm',
    'yyyy-MM-dd HH:mm:ss',
    'yyyy-MM-dd',
    'MM/dd/yyyy HH:mm',
    'MM/dd/yyyy',
  ];
  for (const f of formats) {
    const d = parseDateFns(raw, f, new Date());
    if (isValidDate(d)) return d;
  }
  // Fallback regexes
  const candidates = [
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/,
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?$/,
  ];
  for (const re of candidates) {
    const m = raw.match(re);
    if (m) {
      if (re === candidates[0]) {
        const [, y, mo, d, hh = '00', mm = '00', ss = '00'] = m;
        return new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss));
      } else {
        const [, mo, d, y, hh = '00', mm = '00'] = m;
        const yy = Number((String(y).length === 2) ? `20${y}` : y);
        return new Date(yy, Number(mo) - 1, Number(d), Number(hh), Number(mm));
      }
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  // Authenticate user
  const auth = await getServerAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(req.url);
  const portfolioId = Number(url.searchParams.get('portfolioId') || '1');
  
  // Verify portfolio belongs to user
  const portfolio = await prisma.portfolio.findFirst({ 
    where: { id: Number.isFinite(portfolioId) ? portfolioId : -1, userId: auth.userId } 
  });
  if (!portfolio) return NextResponse.json({ error: 'Invalid portfolio' }, { status: 403 });
  const ct = req.headers.get('content-type') || '';

  let csvText = '';
  if (ct.includes('multipart/form-data')) {
    const fd = await req.formData();
    const file = fd.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'file field is required' }, { status: 400 });
    csvText = await file.text();
  } else if (ct.startsWith('text/csv')) {
    csvText = await req.text();
  } else {
    try {
      const json = await req.json();
      csvText = json?.csvText || '';
    } catch {
      return NextResponse.json({ error: 'Unsupported content-type' }, { status: 400 });
    }
  }

  if (!csvText.trim()) return NextResponse.json({ error: 'Empty CSV' }, { status: 400 });

  const rows = parseCsv(csvText, { columns: true, skip_empty_lines: true }) as Array<Record<string, unknown>>;
  const isTradingView = rows.length > 0 && ['Symbol','Side','Qty','Fill Price','Closing Time'].every(k => Object.prototype.hasOwnProperty.call(rows[0], k));

  type TxInput = {
    asset: string;
    type: 'Buy' | 'Sell' | 'Deposit' | 'Withdrawal' | 'Swap';
    priceUsd?: number | null;
    quantity: number;
    datetime: Date;
    feesUsd?: number | null;
    costUsd?: number | null;
    proceedsUsd?: number | null;
    notes?: string | null;
    portfolioId: number;
  };

  const parsed: TxInput[] = [];
  const allAssets: string[] = [];
  const invalidRows: Array<{row: number, reason: string}> = [];
  
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const obj = r as Record<string, unknown>;
    let asset = '';
    let type: 'Buy' | 'Sell' | 'Deposit' | 'Withdrawal' | 'Swap' = 'Swap';
    let priceUsd: number | null = null;
    let quantity = 0;
    let dt: Date | null = null;
    let feesUsd: number | null = null;
    let notes: string | null = null;

    if (isTradingView) {
      // TradingView columns: Symbol, Side, Qty, Fill Price, Commission, Closing Time
      const sym = String(obj['Symbol'] || '').trim();
      if (!sym) {
        invalidRows.push({row: i + 1, reason: 'Missing Symbol'});
        continue;
      }
      if (sym === '$CASH') asset = 'USD'; else asset = sym.toUpperCase().endsWith('USD') ? sym.toUpperCase().slice(0, -3) : sym.toUpperCase();
      type = normalizeType(obj['Side']);
      priceUsd = parseFloatSafe(obj['Fill Price']);
      const qtyParsed = parseFloatSafe(obj['Qty']) || 0;
      quantity = Math.abs(qtyParsed);
      dt = parseDateFlexible(obj['Closing Time']);
      feesUsd = parseFloatSafe(obj['Commission']);
      notes = null;
    } else {
      asset = String((obj['asset'] ?? obj['Asset'] ?? '')).trim().toUpperCase();
      type = normalizeType(obj['type'] ?? obj['Type']);
      priceUsd = parseFloatSafe(obj['price_usd'] ?? obj['PriceUsd'] ?? obj['Price USD']);
      const qtyParsed = parseFloatSafe(obj['quantity'] ?? obj['Quantity']) || 0;
      quantity = Math.abs(qtyParsed);
      dt = parseDateFlexible(obj['datetime'] ?? obj['Date'] ?? obj['Datetime'] ?? obj['date'] ?? obj['timestamp'] ?? obj['Time'] ?? obj['TimeStamp']);
      feesUsd = parseFloatSafe(obj['fees_usd'] ?? obj['FeesUsd'] ?? obj['Fees USD']);
      notes = obj['notes'] != null ? String(obj['notes']) : null;
    }
    
    if (!asset) {
      invalidRows.push({row: i + 1, reason: 'Missing asset'});
      continue;
    }
    
    allAssets.push(asset);
    const costUsd = parseFloatSafe(obj['cost_usd'] ?? obj['CostUsd'] ?? obj['Cost USD']);
    const proceedsUsd = parseFloatSafe(obj['proceeds_usd'] ?? obj['ProceedsUsd'] ?? obj['Proceeds USD']);
    
    if (!dt) {
      invalidRows.push({row: i + 1, reason: 'Invalid or missing date'});
      continue;
    }
    
    if (quantity <= 0) {
      invalidRows.push({row: i + 1, reason: 'Invalid quantity'});
      continue;
    }
    
    parsed.push({ 
      asset, 
      type, 
      priceUsd: (type==='Buy' || type==='Sell') ? (priceUsd ?? null) : null, 
      quantity, 
      datetime: dt, 
      feesUsd: feesUsd ?? null, 
      costUsd: costUsd ?? null, 
      proceedsUsd: proceedsUsd ?? null, 
      notes: notes ?? null, 
      portfolioId: portfolio.id 
    });
  }

  // Validate assets against supported list
  const uniqueAssets = [...new Set(allAssets)];
  const assetValidation = validateAssetList(uniqueAssets);
  
  // Filter parsed transactions: allow supported crypto assets, and always allow fiat currencies
  const supportedTransactions = parsed.filter(tx => 
    isFiatCurrency(tx.asset) || assetValidation.supported.includes(tx.asset)
  );

  if (!supportedTransactions.length) {
    return NextResponse.json({ 
      imported: 0,
      warnings: {
        unsupportedAssets: assetValidation.unsupported,
        invalidRows: invalidRows,
        totalRows: rows.length,
        supportedRows: 0
      }
    });
  }

  // Convert old format (Buy/Sell) to new format (Swap)
  const convertedTransactions = supportedTransactions.map(tx => {
    if (tx.type === 'Buy') {
      // Buy: USDC -> Crypto
      const costUsd = tx.costUsd ?? (tx.quantity * (tx.priceUsd ?? 0));
      return {
        type: 'Swap',
        datetime: tx.datetime,
        feesUsd: tx.feesUsd,
        notes: tx.notes,
        fromAsset: 'USDC',
        fromQuantity: costUsd,
        fromPriceUsd: 1.0,
        toAsset: tx.asset,
        toQuantity: tx.quantity,
        toPriceUsd: tx.priceUsd ?? (costUsd / tx.quantity),
        portfolioId: tx.portfolioId,
      };
    } else if (tx.type === 'Sell') {
      // Sell: Crypto -> USDC
      const proceedsUsd = tx.proceedsUsd ?? (tx.quantity * (tx.priceUsd ?? 0));
      return {
        type: 'Swap',
        datetime: tx.datetime,
        feesUsd: tx.feesUsd,
        notes: tx.notes,
        fromAsset: tx.asset,
        fromQuantity: tx.quantity,
        fromPriceUsd: tx.priceUsd ?? (proceedsUsd / tx.quantity),
        toAsset: 'USDC',
        toQuantity: proceedsUsd,
        toPriceUsd: 1.0,
        portfolioId: tx.portfolioId,
      };
    } else if (tx.type === 'Deposit') {
      // Deposit: Fiat -> USDC
      return {
        type: 'Deposit',
        datetime: tx.datetime,
        feesUsd: tx.feesUsd,
        notes: tx.notes,
        fromAsset: null,
        fromQuantity: null,
        fromPriceUsd: null,
        toAsset: tx.asset.toUpperCase() === 'USD' ? 'USDC' : tx.asset,
        toQuantity: tx.quantity,
        toPriceUsd: tx.priceUsd ?? 1.0,
        portfolioId: tx.portfolioId,
      };
    } else {
      // Withdrawal: USDC -> Fiat
      return {
        type: 'Withdrawal',
        datetime: tx.datetime,
        feesUsd: tx.feesUsd,
        notes: tx.notes,
        fromAsset: null,
        fromQuantity: null,
        fromPriceUsd: null,
        toAsset: tx.asset.toUpperCase() === 'USD' ? 'USDC' : tx.asset,
        toQuantity: tx.quantity,
        toPriceUsd: tx.priceUsd ?? 1.0,
        portfolioId: tx.portfolioId,
      };
    }
  });

  const chunkSize = 500;
  let imported = 0;
  for (let i = 0; i < convertedTransactions.length; i += chunkSize) {
    const chunk = convertedTransactions.slice(i, i + chunkSize);
    const res = await prisma.transaction.createMany({ data: chunk as Prisma.TransactionCreateManyInput[] });
    imported += res.count;
  }

  // Prepare response with import summary
  const response: {
    imported: number;
    totalRows: number;
    processedRows: number;
    supportedRows: number;
    warnings?: {
      unsupportedAssets: string[];
      invalidRows: Array<{row: number, reason: string}>;
      message: string;
    };
  } = { 
    imported,
    totalRows: rows.length,
    processedRows: parsed.length,
    supportedRows: supportedTransactions.length
  };

  // Add warnings if there are issues
  if (assetValidation.unsupported.length > 0 || invalidRows.length > 0) {
    response.warnings = {
      unsupportedAssets: assetValidation.unsupported,
      invalidRows: invalidRows,
      message: `${assetValidation.unsupported.length > 0 ? 
        `Unsupported cryptocurrencies: ${assetValidation.unsupported.join(', ')}. ` : ''
      }${invalidRows.length > 0 ? 
        `${invalidRows.length} rows had invalid data. ` : ''
      }Only supported cryptocurrencies were imported.`
    };
  }

  return NextResponse.json(response);
}


