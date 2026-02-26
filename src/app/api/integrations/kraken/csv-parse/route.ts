import { NextRequest, NextResponse } from 'next/server';
import { parse as parseCsv } from 'csv-parse/sync';
import { getServerAuth } from '@/lib/auth';
import { isKrakenCsv, parseKrakenCsv } from '@/lib/integrations/kraken';

export async function POST(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const ct = req.headers.get('content-type') || '';
    let csvText = '';

    if (ct.includes('multipart/form-data')) {
      const fd = await req.formData();
      const file = fd.get('file') as File | null;
      if (!file) return NextResponse.json({ error: 'File is required' }, { status: 400 });
      csvText = await file.text();
    } else {
      const body = await req.json();
      csvText = body.csvText || '';
    }

    if (!csvText.trim()) return NextResponse.json({ error: 'Empty CSV' }, { status: 400 });

    const rows = parseCsv(csvText, {
      columns: true, skip_empty_lines: true, bom: true, relax_quotes: true, relax_column_count: true,
    }) as Record<string, string>[];

    if (rows.length === 0) return NextResponse.json({ error: 'No data rows found' }, { status: 400 });

    if (!isKrakenCsv(Object.keys(rows[0] as Record<string, string>))) {
      return NextResponse.json({
        error: 'This does not look like a Kraken ledger CSV. Expected columns: txid, refid, time, type, asset',
      }, { status: 400 });
    }

    const result = parseKrakenCsv(rows as never);

    return NextResponse.json({
      trades: result.trades,
      count: result.trades.length,
      totalRows: rows.length,
      skipped: rows.length - result.trades.length,
      skippedTypes: result.skippedTypes,
      warnings: result.warnings,
      unsupportedAssets: result.unsupportedAssets,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse CSV';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
