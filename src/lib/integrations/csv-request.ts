import { NextRequest, NextResponse } from 'next/server';

interface CsvReadResult {
  csvText?: string;
  errorResponse?: NextResponse;
}

/**
 * Reads CSV text from either multipart/form-data (file field) or JSON payload ({ csvText }).
 */
export async function readCsvTextFromRequest(req: NextRequest): Promise<CsvReadResult> {
  const ct = req.headers.get('content-type') || '';

  try {
    if (ct.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) {
        return {
          errorResponse: NextResponse.json(
            { error: 'File is required' },
            { status: 400 },
          ),
        };
      }
      const csvText = await file.text();
      if (!csvText.trim()) {
        return {
          errorResponse: NextResponse.json(
            { error: 'Empty CSV' },
            { status: 400 },
          ),
        };
      }
      return { csvText };
    }

    const body = await req.json();
    const csvText = typeof body?.csvText === 'string' ? body.csvText : '';
    if (!csvText.trim()) {
      return {
        errorResponse: NextResponse.json(
          { error: 'Empty CSV' },
          { status: 400 },
        ),
      };
    }
    return { csvText };
  } catch {
    return {
      errorResponse: NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 },
      ),
    };
  }
}
