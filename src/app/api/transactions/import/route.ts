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

function normalizeType(v: unknown): 'Deposit' | 'Withdrawal' | 'Swap' {
  const s = String(v || '').toLowerCase();
  if (s === 'swap') return 'Swap';
  if (s === 'deposit') return 'Deposit';
  if (s === 'withdrawal' || s === 'withdraw') return 'Withdrawal';
  return 'Swap'; // Default to Swap
}

function parseDateFlexible(input: unknown): Date | null {
  const raw = String(input || '').replace(/"/g, '').trim();
  if (!raw) return null;
  // Try native
  const native = new Date(raw);
  if (isValidDate(native)) return native;
  // Try common text formats
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
  
  // Verify CSV has required columns for new format
  if (rows.length === 0) {
    return NextResponse.json({ error: 'CSV file is empty' }, { status: 400 });
  }
  
  const firstRow = rows[0];
  const hasRequiredColumns = (
    (Object.prototype.hasOwnProperty.call(firstRow, 'from_asset') || Object.prototype.hasOwnProperty.call(firstRow, 'fromAsset')) &&
    (Object.prototype.hasOwnProperty.call(firstRow, 'to_asset') || Object.prototype.hasOwnProperty.call(firstRow, 'toAsset')) &&
    (Object.prototype.hasOwnProperty.call(firstRow, 'type') || Object.prototype.hasOwnProperty.call(firstRow, 'Type')) &&
    (Object.prototype.hasOwnProperty.call(firstRow, 'datetime') || Object.prototype.hasOwnProperty.call(firstRow, 'Datetime') || Object.prototype.hasOwnProperty.call(firstRow, 'date'))
  );
  
  if (!hasRequiredColumns) {
    return NextResponse.json({ 
      error: 'CSV must have columns: type, datetime, from_asset, from_quantity, to_asset, to_quantity (and optionally from_price_usd, to_price_usd, fees_usd, notes)'
    }, { status: 400 });
  }

  const transactions: Array<Prisma.TransactionCreateManyInput> = [];
  const allAssets: string[] = [];
  const invalidRows: Array<{row: number, reason: string}> = [];
  
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const obj = r as Record<string, unknown>;
    
    const txType = normalizeType(obj['type'] ?? obj['Type']);
    if (txType !== 'Deposit' && txType !== 'Withdrawal' && txType !== 'Swap') {
      invalidRows.push({row: i + 1, reason: `Invalid type: ${txType}. Must be Deposit, Withdrawal, or Swap`});
      continue;
    }
    
    const fromAsset = String((obj['from_asset'] ?? obj['fromAsset'] ?? obj['FromAsset'] ?? '')).trim().toUpperCase() || null;
    const fromQuantity = parseFloatSafe(obj['from_quantity'] ?? obj['fromQuantity'] ?? obj['FromQuantity']);
    const fromPriceUsd = parseFloatSafe(obj['from_price_usd'] ?? obj['fromPriceUsd'] ?? obj['FromPriceUsd']);
    
    const toAsset = String((obj['to_asset'] ?? obj['toAsset'] ?? obj['ToAsset'] ?? '')).trim().toUpperCase();
    const toQuantity = parseFloatSafe(obj['to_quantity'] ?? obj['toQuantity'] ?? obj['ToQuantity']);
    const toPriceUsd = parseFloatSafe(obj['to_price_usd'] ?? obj['toPriceUsd'] ?? obj['ToPriceUsd']);
    
    const dt = parseDateFlexible(obj['datetime'] ?? obj['Datetime'] ?? obj['date'] ?? obj['Date']);
    const feesUsd = parseFloatSafe(obj['fees_usd'] ?? obj['feesUsd'] ?? obj['FeesUsd']);
    const notes = obj['notes'] != null ? String(obj['notes']) : null;
    
    if (!toAsset) {
      invalidRows.push({row: i + 1, reason: 'Missing to_asset'});
      continue;
    }
    
    if (txType === 'Swap' && (!fromAsset || fromQuantity === null || toQuantity === null)) {
      invalidRows.push({row: i + 1, reason: 'Swap transactions require from_asset, from_quantity, and to_quantity'});
      continue;
    }
    
    if (txType === 'Deposit' && (!fromAsset || fromQuantity === null || toQuantity === null)) {
      invalidRows.push({row: i + 1, reason: 'Deposit transactions require from_asset, from_quantity, and to_quantity'});
      continue;
    }
    
    if (txType === 'Withdrawal' && (!fromAsset || fromQuantity === null || toQuantity === null)) {
      invalidRows.push({row: i + 1, reason: 'Withdrawal transactions require from_asset, from_quantity, and to_quantity'});
      continue;
    }
    
    if (!dt) {
      invalidRows.push({row: i + 1, reason: 'Invalid or missing date'});
      continue;
    }
    
    if (fromAsset) allAssets.push(fromAsset);
    allAssets.push(toAsset);
    
    transactions.push({
      type: txType,
      datetime: dt,
      fromAsset: fromAsset || null,
      fromQuantity: fromQuantity ?? null,
      fromPriceUsd: fromPriceUsd ?? null,
      toAsset,
      toQuantity: toQuantity ?? 0,
      toPriceUsd: toPriceUsd ?? null,
      feesUsd: feesUsd ?? null,
      notes: notes ?? null,
      portfolioId: portfolio.id,
    });
  }
  
  // Validate assets
  const uniqueAssets = [...new Set(allAssets)];
  const assetValidation = validateAssetList(uniqueAssets);
  
  // Filter transactions with supported assets
  const supportedTransactions = transactions.filter(tx => {
    const fromValid = !tx.fromAsset || isFiatCurrency(tx.fromAsset) || assetValidation.supported.includes(tx.fromAsset);
    const toValid = isFiatCurrency(tx.toAsset) || assetValidation.supported.includes(tx.toAsset);
    return fromValid && toValid;
  });
  
  if (supportedTransactions.length === 0) {
    return NextResponse.json({ 
      imported: 0,
      totalRows: rows.length,
      processedRows: transactions.length,
      supportedRows: 0,
      warnings: {
        unsupportedAssets: assetValidation.unsupported,
        invalidRows: invalidRows,
        message: `${assetValidation.unsupported.length > 0 ? 
          `Unsupported cryptocurrencies: ${assetValidation.unsupported.join(', ')}. ` : ''
        }${invalidRows.length > 0 ? 
          `${invalidRows.length} rows had invalid data. ` : ''
        }Only supported cryptocurrencies were imported.`
      }
    });
  }
  
  // Import transactions
  const chunkSize = 500;
  let imported = 0;
  for (let i = 0; i < supportedTransactions.length; i += chunkSize) {
    const chunk = supportedTransactions.slice(i, i + chunkSize);
    const res = await prisma.transaction.createMany({ data: chunk });
    imported += res.count;
  }
  
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
    processedRows: transactions.length,
    supportedRows: supportedTransactions.length
  };
  
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
