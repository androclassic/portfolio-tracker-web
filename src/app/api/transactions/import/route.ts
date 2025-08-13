import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { parse as parseCsv } from 'csv-parse/sync';
import { parse as parseDateFns, isValid as isValidDate } from 'date-fns';
import type { Prisma } from '@prisma/client';

function parseFloatSafe(v: unknown): number | null {
  if (v == null) return null;
  const s = String(v).trim().replace(/[+$,]/g, '');
  if (s === '' || s.toLowerCase() === 'nan' || s.toLowerCase() === 'none') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalizeType(v: unknown): 'Buy' | 'Sell' {
  const s = String(v || '').toLowerCase();
  return s === 'sell' ? 'Sell' : 'Buy';
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
  const url = new URL(req.url);
  const portfolioId = Number(url.searchParams.get('portfolioId') || '1');
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

  type TxInput = {
    asset: string;
    type: 'Buy' | 'Sell';
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
  for (const r of rows) {
    const obj = r as Record<string, unknown>;
    const asset = String((obj['asset'] ?? obj['Asset'] ?? '')).trim().toUpperCase();
    if (!asset) continue;
    const type = normalizeType(obj['type'] ?? obj['Type']);
    const priceUsd = parseFloatSafe(obj['price_usd'] ?? obj['PriceUsd'] ?? obj['Price USD']);
    const qtyParsed = parseFloatSafe(obj['quantity'] ?? obj['Quantity']) || 0;
    const quantity = Math.abs(qtyParsed);
    const dt = parseDateFlexible(obj['datetime'] ?? obj['Date'] ?? obj['Datetime'] ?? obj['date'] ?? obj['timestamp'] ?? obj['Time'] ?? obj['TimeStamp']);
    const feesUsd = parseFloatSafe(obj['fees_usd'] ?? obj['FeesUsd'] ?? obj['Fees USD']);
    const costUsd = parseFloatSafe(obj['cost_usd'] ?? obj['CostUsd'] ?? obj['Cost USD']);
    const proceedsUsd = parseFloatSafe(obj['proceeds_usd'] ?? obj['ProceedsUsd'] ?? obj['Proceeds USD']);
    const notes = obj['notes'] != null ? String(obj['notes']) : null;
    if (!dt) continue;
    parsed.push({ asset, type, priceUsd: priceUsd ?? null, quantity, datetime: dt, feesUsd: feesUsd ?? null, costUsd: costUsd ?? null, proceedsUsd: proceedsUsd ?? null, notes: notes ?? null, portfolioId: Number.isFinite(portfolioId) ? portfolioId : 1 });
  }

  if (!parsed.length) return NextResponse.json({ imported: 0 });

  const chunkSize = 500;
  let imported = 0;
  for (let i = 0; i < parsed.length; i += chunkSize) {
    const chunk = parsed.slice(i, i + chunkSize);
    const res = await prisma.transaction.createMany({ data: chunk as Prisma.TransactionCreateManyInput[] });
    imported += res.count;
  }

  return NextResponse.json({ imported });
}


