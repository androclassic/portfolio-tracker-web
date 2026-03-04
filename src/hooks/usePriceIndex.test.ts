import { describe, expect, it } from 'vitest';
import { buildPriceIndex, EMPTY_INDEX } from '@/hooks/usePriceIndex';

describe('buildPriceIndex', () => {
  it('returns EMPTY_INDEX for empty historicalPrices', () => {
    const result = buildPriceIndex([], ['BTC', 'ETH']);
    expect(result).toBe(EMPTY_INDEX);
  });

  it('returns EMPTY_INDEX for empty assets', () => {
    const prices = [
      { asset: 'BTC', date: '2024-01-01', price_usd: 50000 },
    ];
    const result = buildPriceIndex(prices, []);
    expect(result).toBe(EMPTY_INDEX);
  });

  it('builds correct date index from 3 dates', () => {
    const prices = [
      { asset: 'BTC', date: '2024-01-01', price_usd: 50000 },
      { asset: 'BTC', date: '2024-01-02', price_usd: 52000 },
      { asset: 'BTC', date: '2024-01-03', price_usd: 55000 },
    ];
    const result = buildPriceIndex(prices, ['BTC']);

    expect(result.dates).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']);
    expect(result.dateIndex).toEqual({
      '2024-01-01': 0,
      '2024-01-02': 1,
      '2024-01-03': 2,
    });
    expect(result.assetIndex).toEqual({ BTC: 0 });
  });

  it('stablecoins (USDC) get price=1.0 for all dates', () => {
    const prices = [
      { asset: 'BTC', date: '2024-01-01', price_usd: 50000 },
      { asset: 'BTC', date: '2024-01-02', price_usd: 52000 },
      { asset: 'BTC', date: '2024-01-03', price_usd: 55000 },
    ];
    const result = buildPriceIndex(prices, ['USDC', 'BTC']);

    // USDC should be asset index 0, BTC should be asset index 1
    const usdcIdx = result.assetIndex['USDC'];
    expect(result.prices[usdcIdx]).toEqual([1.0, 1.0, 1.0]);
  });

  it('non-stablecoin prices placed at correct indices', () => {
    const prices = [
      { asset: 'BTC', date: '2024-01-01', price_usd: 50000 },
      { asset: 'BTC', date: '2024-01-02', price_usd: 55000 },
    ];
    const result = buildPriceIndex(prices, ['BTC']);

    const btcIdx = result.assetIndex['BTC'];
    expect(result.prices[btcIdx][0]).toBe(50000);
    expect(result.prices[btcIdx][1]).toBe(55000);
  });

  it('missing prices default to 0', () => {
    const prices = [
      { asset: 'BTC', date: '2024-01-01', price_usd: 50000 },
      { asset: 'BTC', date: '2024-01-02', price_usd: 55000 },
    ];
    // ETH is in assets but has no price entries
    const result = buildPriceIndex(prices, ['BTC', 'ETH']);

    const ethIdx = result.assetIndex['ETH'];
    expect(result.prices[ethIdx]).toEqual([0, 0]);
  });
});
