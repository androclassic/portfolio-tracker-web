import { describe, expect, it } from 'vitest';
import { parseKrakenCsv } from '@/lib/integrations/kraken';

describe('parseKrakenCsv', () => {
  it('parses spend/receive groups into normalized trades', () => {
    const rows = [
      {
        txid: 'tx-spend-1',
        refid: 'ref-1',
        time: '2024-03-01 10:00:00',
        type: 'spend',
        subtype: '',
        aclass: 'currency',
        subclass: '',
        asset: 'ZUSD',
        wallet: 'spot',
        amount: '-100',
        fee: '0',
        balance: '0',
      },
      {
        txid: 'tx-receive-1',
        refid: 'ref-1',
        time: '2024-03-01 10:00:00',
        type: 'receive',
        subtype: '',
        aclass: 'currency',
        subclass: '',
        asset: 'XXBT',
        wallet: 'spot',
        amount: '0.002',
        fee: '0',
        balance: '0',
      },
    ];

    const result = parseKrakenCsv(rows);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      fromAsset: 'USD',
      toAsset: 'BTC',
      type: 'Deposit',
      fromQuantity: 100,
      toQuantity: 0.002,
    });
  });

  it('flags unsupported assets in parsed output', () => {
    const rows = [
      {
        txid: 'tx-reward-1',
        refid: 'ref-2',
        time: '2024-03-02 11:00:00',
        type: 'reward',
        subtype: '',
        aclass: 'currency',
        subclass: '',
        asset: 'ZZZZ',
        wallet: 'spot',
        amount: '5',
        fee: '0',
        balance: '0',
      },
    ];

    const result = parseKrakenCsv(rows);
    expect(result.trades).toHaveLength(1);
    expect(result.unsupportedAssets).toContain('ZZZZ');
  });
});
