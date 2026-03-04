import { describe, expect, it } from 'vitest';
import { computeStackedComposition } from '@/hooks/useStackedComposition';
import type { DailyPosition } from '@/hooks/useDailyPositions';

describe('computeStackedComposition', () => {
  it('returns EMPTY for undefined txs', () => {
    const result = computeStackedComposition(
      undefined,
      ['BTC'],
      [],
      [{ asset: 'BTC', date: '2024-01-01', price_usd: 50000 }],
      { BTC: 50000 },
    );
    expect(result.dates).toEqual([]);
    expect(result.totals).toEqual([]);
    expect(result.perAssetUsd.size).toBe(0);
    expect(result.perAssetUnits.size).toBe(0);
  });

  it('returns EMPTY for empty historicalPrices', () => {
    const txs = [
      {
        type: 'Deposit',
        datetime: '2024-01-01T00:00:00Z',
        toAsset: 'BTC',
        toQuantity: 0.5,
      },
    ];
    const result = computeStackedComposition(txs, ['BTC'], [], [], { BTC: 50000 });
    expect(result.dates).toEqual([]);
    expect(result.totals).toEqual([]);
  });

  it('single asset over 3 dates: BTC with position 0.5', () => {
    const dailyPos: DailyPosition[] = [
      { date: '2024-01-01', asset: 'BTC', position: 0.5 },
    ];

    const historicalPrices = [
      { asset: 'BTC', date: '2024-01-01', price_usd: 50000 },
      { asset: 'BTC', date: '2024-01-02', price_usd: 55000 },
      { asset: 'BTC', date: '2024-01-03', price_usd: 60000 },
    ];

    const txs = [
      {
        type: 'Deposit',
        datetime: '2024-01-01T00:00:00Z',
        toAsset: 'BTC',
        toQuantity: 0.5,
      },
    ];

    const result = computeStackedComposition(
      txs,
      ['BTC'],
      dailyPos,
      historicalPrices,
      { BTC: 60000 },
    );

    expect(result.dates).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']);
    const btcUsd = result.perAssetUsd.get('BTC')!;
    expect(btcUsd[0]).toBeCloseTo(25000, 0); // 0.5 * 50000
    expect(btcUsd[1]).toBeCloseTo(27500, 0); // 0.5 * 55000
    expect(btcUsd[2]).toBeCloseTo(30000, 0); // 0.5 * 60000
  });

  it('multiple assets produce correct totals', () => {
    const dailyPos: DailyPosition[] = [
      { date: '2024-01-01', asset: 'BTC', position: 0.5 },
      { date: '2024-01-01', asset: 'ETH', position: 2 },
    ];

    const historicalPrices = [
      { asset: 'BTC', date: '2024-01-01', price_usd: 50000 },
      { asset: 'ETH', date: '2024-01-01', price_usd: 3000 },
      { asset: 'BTC', date: '2024-01-02', price_usd: 55000 },
      { asset: 'ETH', date: '2024-01-02', price_usd: 3200 },
    ];

    const txs = [
      {
        type: 'Deposit',
        datetime: '2024-01-01T00:00:00Z',
        toAsset: 'BTC',
        toQuantity: 0.5,
      },
      {
        type: 'Deposit',
        datetime: '2024-01-01T00:00:00Z',
        toAsset: 'ETH',
        toQuantity: 2,
      },
    ];

    const result = computeStackedComposition(
      txs,
      ['BTC', 'ETH'],
      dailyPos,
      historicalPrices,
      { BTC: 55000, ETH: 3200 },
    );

    // Day 1: BTC = 0.5*50000=25000, ETH = 2*3000=6000, total = 31000
    expect(result.totals[0]).toBeCloseTo(31000, 0);
    // Day 2: BTC = 0.5*55000=27500, ETH = 2*3200=6400, total = 33900
    expect(result.totals[1]).toBeCloseTo(33900, 0);
  });

  it('stablecoins (USDC) valued at 1.0 regardless of prices', () => {
    const dailyPos: DailyPosition[] = [
      { date: '2024-01-01', asset: 'USDC', position: 1000 },
    ];

    const historicalPrices = [
      // Provide a BTC price entry so the date set is non-empty
      { asset: 'BTC', date: '2024-01-01', price_usd: 50000 },
      { asset: 'BTC', date: '2024-01-02', price_usd: 55000 },
    ];

    const txs = [
      {
        type: 'Deposit',
        datetime: '2024-01-01T00:00:00Z',
        toAsset: 'USDC',
        toQuantity: 1000,
      },
    ];

    const result = computeStackedComposition(
      txs,
      ['USDC'],
      dailyPos,
      historicalPrices,
      { USDC: 1 },
    );

    // USDC should be valued at 1.0 * 1000 = 1000 for both dates
    const usdcUsd = result.perAssetUsd.get('USDC')!;
    expect(usdcUsd[0]).toBeCloseTo(1000, 0);
    expect(usdcUsd[1]).toBeCloseTo(1000, 0);
  });

  it('forward-fills last known position when position does not change on a date', () => {
    // Position only set on day 1, but prices span 3 days
    const dailyPos: DailyPosition[] = [
      { date: '2024-01-01', asset: 'BTC', position: 0.5 },
      // No entry for day 2 or day 3 -- the function should forward-fill 0.5
    ];

    const historicalPrices = [
      { asset: 'BTC', date: '2024-01-01', price_usd: 50000 },
      { asset: 'BTC', date: '2024-01-02', price_usd: 55000 },
      { asset: 'BTC', date: '2024-01-03', price_usd: 60000 },
    ];

    const txs = [
      {
        type: 'Deposit',
        datetime: '2024-01-01T00:00:00Z',
        toAsset: 'BTC',
        toQuantity: 0.5,
      },
    ];

    const result = computeStackedComposition(
      txs,
      ['BTC'],
      dailyPos,
      historicalPrices,
      { BTC: 60000 },
    );

    const btcUnits = result.perAssetUnits.get('BTC')!;
    // Position should be forward-filled to 0.5 for all 3 days
    expect(btcUnits[0]).toBeCloseTo(0.5, 8);
    expect(btcUnits[1]).toBeCloseTo(0.5, 8);
    expect(btcUnits[2]).toBeCloseTo(0.5, 8);

    const btcUsd = result.perAssetUsd.get('BTC')!;
    expect(btcUsd[0]).toBeCloseTo(25000, 0);
    expect(btcUsd[1]).toBeCloseTo(27500, 0);
    expect(btcUsd[2]).toBeCloseTo(30000, 0);
  });
});
