import { describe, expect, it } from 'vitest';
import {
  applyTransactionToNetHoldings,
  buildAssetSwapPnlSeries,
  buildAssetPositions,
  computeNetHoldings,
  valueAssetPositions,
  type PortfolioTransactionLike,
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

  // --- Edge cases ---

  it('computeNetHoldings returns empty object for empty transactions', () => {
    expect(computeNetHoldings([])).toEqual({});
  });

  it('buildAssetPositions returns empty object for empty transactions', () => {
    expect(buildAssetPositions([])).toEqual({});
  });

  it('computeNetHoldings handles only deposits (no swaps or withdrawals)', () => {
    const txs: PortfolioTransactionLike[] = [
      { type: 'Deposit', toAsset: 'USDC', toQuantity: 500, toPriceUsd: 1 },
      { type: 'Deposit', toAsset: 'BTC', toQuantity: 0.1, toPriceUsd: 60000 },
    ];
    const holdings = computeNetHoldings(txs);
    expect(holdings.USDC).toBeCloseTo(500, 8);
    expect(holdings.BTC).toBeCloseTo(0.1, 8);
  });

  it('withdrawal exceeding deposit results in negative holdings', () => {
    const txs: PortfolioTransactionLike[] = [
      { type: 'Deposit', toAsset: 'USDC', toQuantity: 100, toPriceUsd: 1 },
      { type: 'Withdrawal', fromAsset: 'USDC', fromQuantity: 200, fromPriceUsd: 1 },
    ];
    const holdings = computeNetHoldings(txs);
    expect(holdings.USDC).toBeCloseTo(-100, 8);
  });

  it('ignores zero-quantity transactions', () => {
    const txs: PortfolioTransactionLike[] = [
      { type: 'Deposit', toAsset: 'BTC', toQuantity: 0, toPriceUsd: 50000 },
      { type: 'Swap', fromAsset: 'USDC', fromQuantity: 0, toAsset: 'ETH', toQuantity: 0 },
    ];
    const holdings = computeNetHoldings(txs);
    // Zero quantities should not create entries (or leave them at 0)
    expect(holdings.BTC || 0).toBe(0);
    expect(holdings.ETH || 0).toBe(0);
  });

  it('handles null/undefined asset and quantity fields gracefully', () => {
    const txs: PortfolioTransactionLike[] = [
      { type: 'Swap', fromAsset: null, fromQuantity: null, toAsset: undefined, toQuantity: undefined },
      { type: 'Deposit', toAsset: '', toQuantity: NaN },
    ];
    const holdings = computeNetHoldings(txs);
    // Should not throw and should return empty or only zero-value entries
    expect(Object.keys(holdings).length).toBe(0);
  });

  it('buildAssetPositions tracks cost basis through buy and partial sell', () => {
    const txs: PortfolioTransactionLike[] = [
      { type: 'Deposit', toAsset: 'USDC', toQuantity: 1000, toPriceUsd: 1 },
      {
        type: 'Swap', fromAsset: 'USDC', fromQuantity: 1000, fromPriceUsd: 1,
        toAsset: 'BTC', toQuantity: 0.02, toPriceUsd: 50000,
      },
      // Sell half at higher price
      {
        type: 'Swap', fromAsset: 'BTC', fromQuantity: 0.01, fromPriceUsd: 60000,
        toAsset: 'USDC', toQuantity: 600, toPriceUsd: 1,
      },
    ];
    const positions = buildAssetPositions(txs);
    // Remaining BTC: 0.01, cost basis should be half of original (500)
    expect(positions.BTC.quantity).toBeCloseTo(0.01, 8);
    expect(positions.BTC.costBasis).toBeCloseTo(500, 2);
    // Realized PnL on sold half: 600 - 500 = 100
    expect(positions.BTC.realizedPnl).toBeCloseTo(100, 2);
  });

  it('valueAssetPositions filters out dust positions', () => {
    const positions = {
      BTC: { quantity: 0.00001, costBasis: 0.5, realizedPnl: 0 },  // Below MIN_QUANTITY
      ETH: { quantity: 1.0, costBasis: 2000, realizedPnl: 50 },
    };
    const { holdings, summary } = valueAssetPositions(positions, { BTC: 60000, ETH: 3000 });
    // BTC should be filtered out (quantity < 0.0001)
    expect(holdings).toHaveLength(1);
    expect(holdings[0].asset).toBe('ETH');
    expect(summary.totalValue).toBeCloseTo(3000, 2);
    // Realized PnL from BTC should still count in total
    expect(summary.totalRealizedPnl).toBeCloseTo(50, 2);
  });

  it('buildAssetSwapPnlSeries returns empty for stablecoins', () => {
    const series = buildAssetSwapPnlSeries(
      [{ type: 'Swap', datetime: '2024-01-01', fromAsset: 'USD', fromQuantity: 100, toAsset: 'USDC', toQuantity: 100, toPriceUsd: 1 }],
      [{ date: '2024-01-01', asset: 'USDC', price_usd: 1 }],
      'USDC',
    );
    expect(series.dates).toEqual([]);
    expect(series.realized).toEqual([]);
  });

  it('buildAssetSwapPnlSeries handles multiple buy/sell cycles', () => {
    const txs: PortfolioTransactionLike[] = [
      // Cycle 1: buy 0.01 BTC @ 50000, sell @ 60000
      { type: 'Swap', datetime: '2024-01-01', fromAsset: 'USDC', fromQuantity: 500, fromPriceUsd: 1, toAsset: 'BTC', toQuantity: 0.01, toPriceUsd: 50000 },
      { type: 'Swap', datetime: '2024-01-03', fromAsset: 'BTC', fromQuantity: 0.01, fromPriceUsd: 60000, toAsset: 'USDC', toQuantity: 600, toPriceUsd: 1 },
      // Cycle 2: buy 0.02 BTC @ 55000, sell @ 65000
      { type: 'Swap', datetime: '2024-01-05', fromAsset: 'USDC', fromQuantity: 1100, fromPriceUsd: 1, toAsset: 'BTC', toQuantity: 0.02, toPriceUsd: 55000 },
      { type: 'Swap', datetime: '2024-01-07', fromAsset: 'BTC', fromQuantity: 0.02, fromPriceUsd: 65000, toAsset: 'USDC', toQuantity: 1300, toPriceUsd: 1 },
    ];
    const prices = [
      { date: '2024-01-01', asset: 'BTC', price_usd: 50000 },
      { date: '2024-01-02', asset: 'BTC', price_usd: 55000 },
      { date: '2024-01-03', asset: 'BTC', price_usd: 60000 },
      { date: '2024-01-04', asset: 'BTC', price_usd: 58000 },
      { date: '2024-01-05', asset: 'BTC', price_usd: 55000 },
      { date: '2024-01-06', asset: 'BTC', price_usd: 62000 },
      { date: '2024-01-07', asset: 'BTC', price_usd: 65000 },
    ];

    const series = buildAssetSwapPnlSeries(txs, prices, 'BTC');
    expect(series.dates).toHaveLength(7);

    // After cycle 1 sell (day 3): realized = (60000-50000)*0.01 = 100
    expect(series.realized[2]).toBeCloseTo(100, 2);
    // After both sells (day 7): realized += (65000-55000)*0.02 = 200 → total 300
    expect(series.realized[6]).toBeCloseTo(300, 2);
    // After all sold, unrealized should be 0
    expect(series.unrealized[6]).toBeCloseTo(0, 2);
  });

  it('buildAssetSwapPnlSeries ignores non-Swap transactions', () => {
    const txs: PortfolioTransactionLike[] = [
      { type: 'Deposit', datetime: '2024-01-01', toAsset: 'BTC', toQuantity: 0.5, toPriceUsd: 50000 },
      { type: 'Withdrawal', datetime: '2024-01-02', fromAsset: 'BTC', fromQuantity: 0.1, fromPriceUsd: 55000 },
    ];
    const prices = [
      { date: '2024-01-01', asset: 'BTC', price_usd: 50000 },
      { date: '2024-01-02', asset: 'BTC', price_usd: 55000 },
    ];
    const series = buildAssetSwapPnlSeries(txs, prices, 'BTC');
    // Deposits and withdrawals should not affect swap PnL series
    expect(series.realized[0]).toBe(0);
    expect(series.realized[1]).toBe(0);
  });

  it('getTransactionDateKey handles Date objects and invalid dates', () => {
    // Indirectly test via buildAssetSwapPnlSeries
    const txs: PortfolioTransactionLike[] = [
      { type: 'Swap', datetime: new Date('2024-03-15'), fromAsset: 'USDC', fromQuantity: 100, toAsset: 'BTC', toQuantity: 0.002, toPriceUsd: 50000 },
      { type: 'Swap', datetime: 'not-a-date', fromAsset: 'USDC', fromQuantity: 50, toAsset: 'BTC', toQuantity: 0.001, toPriceUsd: 50000 },
    ];
    const prices = [{ date: '2024-03-15', asset: 'BTC', price_usd: 50000 }];
    const series = buildAssetSwapPnlSeries(txs, prices, 'BTC');
    // Should process the valid Date object and skip the invalid one
    expect(series.dates).toEqual(['2024-03-15']);
    expect(series.unrealized[0]).toBeCloseTo(0, 2); // bought at market price, so 0 unrealized
  });
});
