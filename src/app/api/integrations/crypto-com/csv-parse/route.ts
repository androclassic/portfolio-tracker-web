import { NextRequest, NextResponse } from 'next/server';
import { parse as parseCsv } from 'csv-parse/sync';
import { getServerAuth } from '@/lib/auth';
import { isCryptoComAppCsv, parseCryptoComAppCsv } from '@/lib/integrations/crypto-com-csv';

export async function POST(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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

    if (!csvText.trim()) {
      return NextResponse.json({ error: 'Empty CSV' }, { status: 400 });
    }

    const rows = parseCsv(csvText, { columns: true, skip_empty_lines: true, bom: true }) as Record<string, string>[];

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No data rows found in CSV' }, { status: 400 });
    }

    const headers = Object.keys(rows[0] as Record<string, string>);
    if (!isCryptoComAppCsv(headers)) {
      return NextResponse.json({
        error: 'This does not look like a Crypto.com App CSV. Expected columns: Timestamp, Transaction Description, Currency, Amount',
      }, { status: 400 });
    }

    const trades = parseCryptoComAppCsv(rows as never);

    return NextResponse.json({
      trades,
      count: trades.length,
      totalRows: rows.length,
      skipped: rows.length - trades.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse CSV';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
