import { describe, expect, it } from 'vitest';
import {
  connectionCreateBodySchema,
  credentialsFetchBodySchema,
  importRequestBodySchema,
  syncRequestBodySchema,
} from '@/lib/integrations/request-schemas';

describe('integration request schemas', () => {
  it('rejects connection create payload without apiSecret', () => {
    const result = connectionCreateBodySchema.safeParse({
      exchange: 'crypto-com',
      apiKey: 'abc',
    });

    expect(result.success).toBe(false);
  });

  it('normalizes sync payload from string values', () => {
    const result = syncRequestBodySchema.safeParse({
      exchange: 'KRAKEN',
      auto: 'true',
      days: '12',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      exchange: 'kraken',
      auto: true,
      days: 12,
    });
  });

  it('rejects import payload with empty trades list', () => {
    const result = importRequestBodySchema.safeParse({
      trades: [],
      portfolioId: 1,
    });

    expect(result.success).toBe(false);
  });

  it('rejects partial credential fetch payload', () => {
    const result = credentialsFetchBodySchema.safeParse({
      apiKey: 'key-only',
    });

    expect(result.success).toBe(false);
  });
});
