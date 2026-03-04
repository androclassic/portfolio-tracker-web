import { describe, expect, it } from 'vitest';
import {
  computeDailyPositions,
  computeNotesByDayAsset,
} from '@/hooks/useDailyPositions';

describe('computeDailyPositions', () => {
  it('returns empty for undefined txs', () => {
    expect(computeDailyPositions(undefined)).toEqual([]);
  });

  it('returns empty for empty array', () => {
    expect(computeDailyPositions([])).toEqual([]);
  });

  it('single deposit creates one daily position', () => {
    const txs = [
      {
        type: 'Deposit',
        datetime: '2024-01-01T12:00:00Z',
        toAsset: 'USDC',
        toQuantity: 100,
      },
    ];

    const result = computeDailyPositions(txs);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      date: '2024-01-01',
      asset: 'USDC',
      position: 100,
    });
  });

  it('swap creates positive and negative entries', () => {
    const txs = [
      {
        type: 'Deposit',
        datetime: '2024-01-01T10:00:00Z',
        toAsset: 'USDC',
        toQuantity: 100,
      },
      {
        type: 'Swap',
        datetime: '2024-01-01T12:00:00Z',
        fromAsset: 'USDC',
        fromQuantity: 100,
        toAsset: 'BTC',
        toQuantity: 0.002,
      },
    ];

    const result = computeDailyPositions(txs);
    // USDC: deposit +100, swap -100 = 0 on same day
    const usdcPos = result.find((r) => r.asset === 'USDC');
    expect(usdcPos?.position).toBeCloseTo(0, 8);
    // BTC: swap +0.002
    const btcPos = result.find((r) => r.asset === 'BTC');
    expect(btcPos?.position).toBeCloseTo(0.002, 8);
  });

  it('cumulative positions across multiple days', () => {
    const txs = [
      {
        type: 'Deposit',
        datetime: '2024-01-01T10:00:00Z',
        toAsset: 'USDC',
        toQuantity: 100,
      },
      {
        type: 'Deposit',
        datetime: '2024-01-02T10:00:00Z',
        toAsset: 'USDC',
        toQuantity: 200,
      },
    ];

    const result = computeDailyPositions(txs);
    // Should have two entries for USDC: day1 = 100, day2 = 300 (cumulative)
    const usdcPositions = result
      .filter((r) => r.asset === 'USDC')
      .sort((a, b) => a.date.localeCompare(b.date));
    expect(usdcPositions).toHaveLength(2);
    expect(usdcPositions[0].position).toBeCloseTo(100, 8);
    expect(usdcPositions[1].position).toBeCloseTo(300, 8);
  });

  it('USD transactions are excluded', () => {
    const txs = [
      {
        type: 'Deposit',
        datetime: '2024-01-01T10:00:00Z',
        toAsset: 'USD',
        toQuantity: 1000,
      },
      {
        type: 'Deposit',
        datetime: '2024-01-01T12:00:00Z',
        toAsset: 'BTC',
        toQuantity: 0.01,
      },
    ];

    const result = computeDailyPositions(txs);
    // USD should be excluded, only BTC should appear
    const usdPos = result.find((r) => r.asset === 'USD');
    expect(usdPos).toBeUndefined();
    const btcPos = result.find((r) => r.asset === 'BTC');
    expect(btcPos?.position).toBeCloseTo(0.01, 8);
  });
});

describe('computeNotesByDayAsset', () => {
  it('maps notes correctly', () => {
    const datetime = '2024-01-01T12:00:00Z';
    const txs = [
      {
        type: 'Deposit',
        datetime,
        toAsset: 'BTC',
        toQuantity: 0.5,
        notes: 'First buy',
      },
    ];

    // computeNotesByDayAsset uses local date parts then toISOString, so
    // compute the expected key the same way to stay timezone-resilient.
    const d = new Date(datetime);
    const localDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const expectedKey = localDay.toISOString().slice(0, 10) + '|BTC';

    const map = computeNotesByDayAsset(txs);
    expect(map.get(expectedKey)).toBe('• First buy');
  });

  it('returns empty map for undefined txs', () => {
    const map = computeNotesByDayAsset(undefined);
    expect(map.size).toBe(0);
  });

  it('skips transactions without notes', () => {
    const txs = [
      {
        type: 'Deposit',
        datetime: '2024-01-01T12:00:00Z',
        toAsset: 'BTC',
        toQuantity: 0.5,
        notes: null,
      },
      {
        type: 'Deposit',
        datetime: '2024-01-01T12:00:00Z',
        toAsset: 'ETH',
        toQuantity: 1,
        notes: '',
      },
    ];

    const map = computeNotesByDayAsset(txs);
    expect(map.size).toBe(0);
  });
});
