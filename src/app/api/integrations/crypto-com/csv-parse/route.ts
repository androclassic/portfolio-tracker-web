import { NextRequest, NextResponse } from 'next/server';
import { parse as parseCsv } from 'csv-parse/sync';
import { isCryptoComAppCsv, parseCryptoComAppCsv } from '@/lib/integrations/crypto-com-csv';
import { readCsvTextFromRequest } from '@/lib/integrations/csv-request';
import { withServerAuthRateLimit } from '@/lib/api/route-auth';

export const POST = withServerAuthRateLimit(async (req: NextRequest) => {
  try {
    const { csvText, errorResponse } = await readCsvTextFromRequest(req);
    if (errorResponse) return errorResponse;

    const rows = parseCsv(csvText!, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true,
    }) as Record<string, string>[];

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No data rows found in CSV' }, { status: 400 });
    }

    const headers = Object.keys(rows[0] as Record<string, string>);
    if (!isCryptoComAppCsv(headers)) {
      return NextResponse.json({
        error: 'This does not look like a Crypto.com App CSV. Expected columns: Timestamp (UTC), Transaction Description, Currency, Amount',
        foundHeaders: headers,
      }, { status: 400 });
    }

    const result = parseCryptoComAppCsv(rows as never);

    return NextResponse.json({
      trades: result.trades,
      count: result.trades.length,
      totalRows: rows.length,
      skipped: rows.length - result.trades.length,
      skippedKinds: result.skippedKinds,
      warnings: result.warnings,
      unsupportedAssets: result.unsupportedAssets,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to parse CSV';
    console.error('[Crypto.com CSV] Parse error:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
});
