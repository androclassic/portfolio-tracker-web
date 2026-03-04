import { describe, expect, it } from 'vitest';
import { computePnL } from '@/hooks/usePnLCalculation';
import type { PortfolioTransactionLike } from '@/lib/portfolio-engine';

describe('computePnL', () => {
  it('returns zeros for undefined txs', () => {
    const result = computePnL(undefined, { BTC: 60000 });
    expect(result.totalPnL).toBe(0);
    expect(result.totalPnLPercent).toBe(0);
    expect(result.realizedPnL).toBe(0);
    expect(result.unrealizedPnL).toBe(0);
    expect(result.assetPnL).toEqual({});
  });

  it('returns zeros for empty currentPrices', () => {
    const txs: PortfolioTransactionLike[] = [
      { type: 'Deposit', toAsset: 'USDC', toQuantity: 1000, toPriceUsd: 1 },
    ];
    const result = computePnL(txs, {});
    expect(result.totalPnL).toBe(0);
    expect(result.totalPnLPercent).toBe(0);
    expect(result.realizedPnL).toBe(0);
    expect(result.unrealizedPnL).toBe(0);
    expect(result.assetPnL).toEqual({});
  });

  it('returns zeros for empty txs array', () => {
    const result = computePnL([], { BTC: 60000 });
    // Empty txs produce no positions, so everything is zero
    expect(result.totalPnL).toBe(0);
    expect(result.totalPnLPercent).toBe(0);
    expect(result.realizedPnL).toBe(0);
    expect(result.unrealizedPnL).toBe(0);
    expect(result.assetPnL).toEqual({});
  });

  it('calculates P&L from deposit + buy BTC scenario', () => {
    const txs: PortfolioTransactionLike[] = [
      // Deposit 1000 USDC
      {
        type: 'Deposit',
        toAsset: 'USDC',
        toQuantity: 1000,
        toPriceUsd: 1,
      },
      // Buy 0.02 BTC at 50000 (costs 1000 USDC)
      {
        type: 'Swap',
        fromAsset: 'USDC',
        fromQuantity: 1000,
        fromPriceUsd: 1,
        toAsset: 'BTC',
        toQuantity: 0.02,
        toPriceUsd: 50000,
      },
    ];

    // Current BTC price is 60000, so 0.02 BTC = 1200 USD
    // Cost basis for BTC = 1000, unrealized = 1200 - 1000 = 200
    const result = computePnL(txs, { BTC: 60000 });
    expect(result.unrealizedPnL).toBeCloseTo(200, 2);
  });

  it('populates per-asset P&L correctly', () => {
    const txs: PortfolioTransactionLike[] = [
      {
        type: 'Deposit',
        toAsset: 'USDC',
        toQuantity: 1000,
        toPriceUsd: 1,
      },
      {
        type: 'Swap',
        fromAsset: 'USDC',
        fromQuantity: 1000,
        fromPriceUsd: 1,
        toAsset: 'BTC',
        toQuantity: 0.02,
        toPriceUsd: 50000,
      },
    ];

    const result = computePnL(txs, { BTC: 60000 });
    expect(result.assetPnL).toHaveProperty('BTC');
    const btcPnl = result.assetPnL['BTC'];
    expect(btcPnl.costBasis).toBeCloseTo(1000, 2);
    expect(btcPnl.currentValue).toBeCloseTo(1200, 2);
    expect(btcPnl.pnl).toBeCloseTo(200, 2);
  });

  it('handles multiple assets with different gains', () => {
    const txs: PortfolioTransactionLike[] = [
      // Deposit USDC
      {
        type: 'Deposit',
        toAsset: 'USDC',
        toQuantity: 5000,
        toPriceUsd: 1,
      },
      // Buy 0.02 BTC at 50000 (costs 1000)
      {
        type: 'Swap',
        fromAsset: 'USDC',
        fromQuantity: 1000,
        fromPriceUsd: 1,
        toAsset: 'BTC',
        toQuantity: 0.02,
        toPriceUsd: 50000,
      },
      // Buy 1 ETH at 3000 (costs 3000)
      {
        type: 'Swap',
        fromAsset: 'USDC',
        fromQuantity: 3000,
        fromPriceUsd: 1,
        toAsset: 'ETH',
        toQuantity: 1,
        toPriceUsd: 3000,
      },
    ];

    // BTC: 0.02 * 70000 = 1400, cost = 1000, unrealized = 400
    // ETH: 1 * 3500 = 3500, cost = 3000, unrealized = 500
    // USDC: 1000 * 1 = 1000, cost = 1000, unrealized = 0
    const result = computePnL(txs, { BTC: 70000, ETH: 3500 });
    expect(result.assetPnL).toHaveProperty('BTC');
    expect(result.assetPnL).toHaveProperty('ETH');
    expect(result.assetPnL['BTC'].pnl).toBeCloseTo(400, 2);
    expect(result.assetPnL['ETH'].pnl).toBeCloseTo(500, 2);
    // Total unrealized = 400 + 500 = 900
    expect(result.unrealizedPnL).toBeCloseTo(900, 2);
  });

  it('P&L percent correct for positive scenario', () => {
    const txs: PortfolioTransactionLike[] = [
      {
        type: 'Deposit',
        toAsset: 'USDC',
        toQuantity: 1000,
        toPriceUsd: 1,
      },
      {
        type: 'Swap',
        fromAsset: 'USDC',
        fromQuantity: 1000,
        fromPriceUsd: 1,
        toAsset: 'BTC',
        toQuantity: 0.02,
        toPriceUsd: 50000,
      },
    ];

    // BTC: cost 1000, current value 1200 at 60000, unrealized PnL = 200
    // PnL percent on BTC = 200/1000 * 100 = 20%
    const result = computePnL(txs, { BTC: 60000 });
    expect(result.assetPnL['BTC'].pnlPercent).toBeCloseTo(20, 1);
  });

  it('includes realized P&L on partial sell', () => {
    const txs: PortfolioTransactionLike[] = [
      // Deposit USDC
      {
        type: 'Deposit',
        toAsset: 'USDC',
        toQuantity: 1000,
        toPriceUsd: 1,
      },
      // Buy 0.02 BTC at 50000 (cost 1000)
      {
        type: 'Swap',
        fromAsset: 'USDC',
        fromQuantity: 1000,
        fromPriceUsd: 1,
        toAsset: 'BTC',
        toQuantity: 0.02,
        toPriceUsd: 50000,
      },
      // Sell 0.01 BTC at 60000 (proceeds 600)
      {
        type: 'Swap',
        fromAsset: 'BTC',
        fromQuantity: 0.01,
        fromPriceUsd: 60000,
        toAsset: 'USDC',
        toQuantity: 600,
        toPriceUsd: 1,
      },
    ];

    // Sold half at 60000, cost basis for that half was 500
    // Realized PnL = 600 - 500 = 100
    const result = computePnL(txs, { BTC: 60000 });
    expect(result.realizedPnL).toBeCloseTo(100, 2);
    // Remaining 0.01 BTC: cost = 500, value = 600, unrealized = 100
    expect(result.assetPnL['BTC'].costBasis).toBeCloseTo(500, 2);
    expect(result.unrealizedPnL).toBeCloseTo(100, 2);
  });
});
