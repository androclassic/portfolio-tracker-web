import { describe, expect, it } from 'vitest';
import {
  applyTransactionToNetHoldings,
  buildAssetSwapPnlSeries,
  buildAssetPositions,
  computeNetHoldings,
  valueAssetPositions,
} from '@/lib/portfolio-engine';

describe('portfolio-engine', () => {
  it('computes net holdings with canonical transaction semantics', () => {
    const txs = [
      { type: 'Deposit', toAsset: 'USDC', toQuantity: 100 },
      { type: 'Swap', fromAsset: 'USDC', fromQuantity: 25, toAsset: 'BTC', toQuantity: 0.001 },
      { type: 'Withdrawal', fromAsset: 'USDC', fromQuantity: 10 },
    ];

    const holdings = computeNetHoldings(txs);
    expect(holdings.USDC).toBeCloseTo(65, 8);
    expect(holdings.BTC).toBeCloseTo(0.001, 8);
  });

  it('builds positions and valuation summary including realized and unrealized pnl', () => {
    const txs = [
      {
        type: 'Deposit',
        fromAsset: 'EUR',
        fromQuantity: 1000,
        fromPriceUsd: 1.1,
        toAsset: 'USDC',
        toQuantity: 1100,
        toPriceUsd: 1,
      },
      {
        type: 'Swap',
        fromAsset: 'USDC',
        fromQuantity: 100,
        fromPriceUsd: 1,
        toAsset: 'BTC',
        toQuantity: 0.002,
        toPriceUsd: 50000,
      },
      {
        type: 'Withdrawal',
        fromAsset: 'USDC',
        fromQuantity: 200,
        fromPriceUsd: 1,
        toAsset: 'EUR',
        toQuantity: 182,
        toPriceUsd: 1.1,
      },
    ];

    const positions = buildAssetPositions(txs);
    expect(positions.USDC?.quantity).toBeCloseTo(800, 8);
    expect(positions.BTC?.quantity).toBeCloseTo(0.002, 8);

    const valued = valueAssetPositions(positions, { BTC: 60000 });
    expect(valued.summary.totalValue).toBeCloseTo(920, 8);
    expect(valued.summary.totalCost).toBeCloseTo(900, 8);
    expect(valued.summary.totalUnrealizedPnl).toBeCloseTo(20, 8);
    expect(valued.summary.totalRealizedPnl).toBeCloseTo(0.2, 8);
    expect(valued.summary.totalNetPnl).toBeCloseTo(20.2, 8);
  });

  it('applies transaction deltas in-place', () => {
    const holdings: Record<string, number> = {};
    applyTransactionToNetHoldings(holdings, {
      type: 'Swap',
      fromAsset: 'ETH',
      fromQuantity: 1.5,
      toAsset: 'SOL',
      toQuantity: 20,
    });

    expect(holdings.ETH).toBeCloseTo(-1.5, 8);
    expect(holdings.SOL).toBeCloseTo(20, 8);
  });

  it('builds single-asset pnl series from swaps and historical prices', () => {
    const series = buildAssetSwapPnlSeries(
      [
        {
          type: 'Swap',
          datetime: '2024-01-01T00:00:00Z',
          fromAsset: 'USDC',
          fromQuantity: 100,
          fromPriceUsd: 1,
          toAsset: 'BTC',
          toQuantity: 0.002,
          toPriceUsd: 50000,
        },
        {
          type: 'Swap',
          datetime: '2024-01-03T00:00:00Z',
          fromAsset: 'BTC',
          fromQuantity: 0.001,
          fromPriceUsd: 55000,
          toAsset: 'USDC',
          toQuantity: 55,
          toPriceUsd: 1,
        },
      ],
      [
        { date: '2024-01-01', asset: 'BTC', price_usd: 50000 },
        { date: '2024-01-02', asset: 'BTC', price_usd: 52000 },
        { date: '2024-01-03', asset: 'BTC', price_usd: 55000 },
      ],
      'BTC',
    );

    expect(series.dates).toEqual(['2024-01-01', '2024-01-02', '2024-01-03']);
    expect(series.realized[2]).toBeCloseTo(5, 8);
    expect(series.unrealized[1]).toBeCloseTo(4, 8);
  });
});
