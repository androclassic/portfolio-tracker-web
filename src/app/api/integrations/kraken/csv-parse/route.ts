import { NextRequest, NextResponse } from 'next/server';
import { parse as parseCsv } from 'csv-parse/sync';
import { isKrakenCsv, parseKrakenCsv } from '@/lib/integrations/kraken';
import { readCsvTextFromRequest } from '@/lib/integrations/csv-request';
import { withServerAuthRateLimit } from '@/lib/api/route-auth';

export const POST = withServerAuthRateLimit(async (req: NextRequest) => {
  try {
    const { csvText, errorResponse } = await readCsvTextFromRequest(req);
    if (errorResponse) return errorResponse;

    const rows = parseCsv(csvText!, {
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
});
