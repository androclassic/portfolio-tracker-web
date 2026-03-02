import { describe, expect, it } from 'vitest';
import { parseCryptoComAppCsv } from '@/lib/integrations/crypto-com-csv';

describe('parseCryptoComAppCsv', () => {
  it('parses purchase rows into normalized swap trades', () => {
    const rows = [
      {
        'Timestamp (UTC)': '2024-01-01 12:00:00',
        'Transaction Kind': 'crypto_purchase',
        'Transaction Description': 'Buy BTC',
        Currency: 'USD',
        Amount: '-100',
        'To Currency': 'BTC',
        'To Amount': '0.002',
        'Native Amount (in USD)': '100',
      },
    ];

    const result = parseCryptoComAppCsv(rows);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      type: 'Swap',
      fromAsset: 'USD',
      toAsset: 'BTC',
      fromQuantity: 100,
      toQuantity: 0.002,
    });
  });

  it('reports unsupported assets from parsed rows', () => {
    const rows = [
      {
        'Timestamp (UTC)': '2024-02-01 08:00:00',
        'Transaction Kind': 'crypto_deposit',
        'Transaction Description': 'Deposit unknown token',
        Currency: 'ZZZZ',
        Amount: '10',
        'Native Amount (in USD)': '10',
      },
    ];

    const result = parseCryptoComAppCsv(rows);
    expect(result.trades).toHaveLength(1);
    expect(result.unsupportedAssets).toContain('ZZZZ');
  });
});
