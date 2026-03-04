import { describe, expect, it, vi, beforeEach } from 'vitest';
import { calculateRomaniaTax } from '@/lib/tax/romania-v2';
import type { Transaction } from '@/lib/types';

// Mock exchange rates to return deterministic values
vi.mock('@/lib/exchange-rates', () => ({
  getHistoricalExchangeRateSyncStrict: (from: string, to: string) => {
    if (from === to) return 1.0;
    if (from === 'EUR' && to === 'USD') return 1.10;
    if (from === 'USD' && to === 'EUR') return 1 / 1.10;
    return 1.0;
  },
}));

let nextId = 1;
function tx(overrides: Partial<Transaction> & Pick<Transaction, 'type' | 'toAsset' | 'toQuantity'>): Transaction {
  return {
    id: nextId++,
    datetime: '2024-06-15T12:00:00Z',
    ...overrides,
  } as Transaction;
}

beforeEach(() => { nextId = 1; });

describe('calculateRomaniaTax', () => {
  it('simple deposit then withdrawal produces zero gain', () => {
    // Deposit 1000 EUR → 1100 USDC, withdraw 1100 USDC → ~1000 EUR
    const txs: Transaction[] = [
      tx({
        type: 'Deposit',
        fromAsset: 'EUR', fromQuantity: 1000, fromPriceUsd: 1.10,
        toAsset: 'USDC', toQuantity: 1100, toPriceUsd: 1,
        datetime: '2024-01-01T00:00:00Z',
      }),
      tx({
        type: 'Withdrawal',
        fromAsset: 'USDC', fromQuantity: 1100, fromPriceUsd: 1,
        toAsset: 'EUR', toQuantity: 1000, toPriceUsd: 1.10,
        datetime: '2024-06-01T00:00:00Z',
      }),
    ];

    const report = calculateRomaniaTax(txs, '2024', 4.5);
    expect(report.taxableEvents).toHaveLength(1);
    // Cost basis = amount deposited in USD = 1100
    // Withdrawal = 1100 USDC = 1100 USD
    // Gain = 0
    expect(report.totalGainLossUsd).toBeCloseTo(0, 2);
  });

  it('full cycle: deposit → buy crypto → sell → withdraw captures BTC gain', () => {
    const txs: Transaction[] = [
      // Deposit 1000 EUR → 1100 USDC
      tx({
        type: 'Deposit',
        fromAsset: 'EUR', fromQuantity: 1000, fromPriceUsd: 1.10,
        toAsset: 'USDC', toQuantity: 1100, toPriceUsd: 1,
        datetime: '2024-01-01T00:00:00Z',
      }),
      // Buy 0.02 BTC for 1100 USDC (@$55000)
      tx({
        type: 'Swap',
        fromAsset: 'USDC', fromQuantity: 1100, fromPriceUsd: 1,
        toAsset: 'BTC', toQuantity: 0.02, toPriceUsd: 55000,
        datetime: '2024-02-01T00:00:00Z',
      }),
      // Sell 0.02 BTC for 1400 USDC (@$70000) - BTC went up
      tx({
        type: 'Swap',
        fromAsset: 'BTC', fromQuantity: 0.02, fromPriceUsd: 70000,
        toAsset: 'USDC', toQuantity: 1400, toPriceUsd: 1,
        datetime: '2024-06-01T00:00:00Z',
      }),
      // Withdraw 1400 USDC → ~1273 EUR
      tx({
        type: 'Withdrawal',
        fromAsset: 'USDC', fromQuantity: 1400, fromPriceUsd: 1,
        toAsset: 'EUR', toQuantity: 1273, toPriceUsd: 1.10,
        datetime: '2024-07-01T00:00:00Z',
      }),
    ];

    const report = calculateRomaniaTax(txs, '2024', 4.5);
    expect(report.taxableEvents).toHaveLength(1);
    // Withdrew 1400 USD. Cost basis was 1100 USD (original deposit cost).
    // Gain = 1400 - 1100 = 300 USD
    expect(report.totalGainLossUsd).toBeCloseTo(300, 2);
  });

  it('FIFO lot ordering: uses earliest deposit first', () => {
    const txs: Transaction[] = [
      // Deposit 500 USDC (cost basis 500 USD)
      tx({
        type: 'Deposit',
        fromAsset: 'USD', fromQuantity: 500,
        toAsset: 'USDC', toQuantity: 500, toPriceUsd: 1,
        datetime: '2024-01-01T00:00:00Z',
      }),
      // Deposit another 500 USDC (cost basis 500 USD)
      tx({
        type: 'Deposit',
        fromAsset: 'USD', fromQuantity: 500,
        toAsset: 'USDC', toQuantity: 500, toPriceUsd: 1,
        datetime: '2024-02-01T00:00:00Z',
      }),
      // Withdraw 500 USDC → should use first deposit (FIFO)
      tx({
        type: 'Withdrawal',
        fromAsset: 'USDC', fromQuantity: 500, fromPriceUsd: 1,
        toAsset: 'USD', toQuantity: 500, toPriceUsd: 1,
        datetime: '2024-06-01T00:00:00Z',
      }),
    ];

    const report = calculateRomaniaTax(txs, '2024', 4.5, { cashStrategy: 'FIFO' });
    expect(report.taxableEvents).toHaveLength(1);
    // Cost basis = 500 (from first deposit), withdrawal = 500
    expect(report.totalGainLossUsd).toBeCloseTo(0, 2);
    // Remaining cash should be 500 (from second deposit)
    expect(report.remainingCashUsd).toBeCloseTo(500, 2);
  });

  it('crypto-to-crypto swap transfers cost basis', () => {
    const txs: Transaction[] = [
      tx({
        type: 'Deposit',
        fromAsset: 'USD', fromQuantity: 1000,
        toAsset: 'USDC', toQuantity: 1000, toPriceUsd: 1,
        datetime: '2024-01-01T00:00:00Z',
      }),
      // Buy 0.02 BTC for 1000 USDC
      tx({
        type: 'Swap',
        fromAsset: 'USDC', fromQuantity: 1000, fromPriceUsd: 1,
        toAsset: 'BTC', toQuantity: 0.02, toPriceUsd: 50000,
        datetime: '2024-02-01T00:00:00Z',
      }),
      // Swap BTC → ETH (cost basis transfers)
      tx({
        type: 'Swap',
        fromAsset: 'BTC', fromQuantity: 0.02, fromPriceUsd: 55000,
        toAsset: 'ETH', toQuantity: 0.5, toPriceUsd: 2200,
        datetime: '2024-03-01T00:00:00Z',
      }),
      // Sell ETH → USDC
      tx({
        type: 'Swap',
        fromAsset: 'ETH', fromQuantity: 0.5, fromPriceUsd: 3000,
        toAsset: 'USDC', toQuantity: 1500, toPriceUsd: 1,
        datetime: '2024-06-01T00:00:00Z',
      }),
      // Withdraw
      tx({
        type: 'Withdrawal',
        fromAsset: 'USDC', fromQuantity: 1500, fromPriceUsd: 1,
        toAsset: 'USD', toQuantity: 1500, toPriceUsd: 1,
        datetime: '2024-07-01T00:00:00Z',
      }),
    ];

    const report = calculateRomaniaTax(txs, '2024', 4.5);
    expect(report.taxableEvents).toHaveLength(1);
    // Original cost basis was 1000 USD (from deposit).
    // Withdrew 1500 USD. Gain = 500.
    expect(report.totalGainLossUsd).toBeCloseTo(500, 2);
  });

  it('stablecoin-to-stablecoin swap generates warning', () => {
    const txs: Transaction[] = [
      tx({
        type: 'Deposit',
        fromAsset: 'USD', fromQuantity: 100,
        toAsset: 'USDC', toQuantity: 100, toPriceUsd: 1,
        datetime: '2024-01-01T00:00:00Z',
      }),
      tx({
        type: 'Swap',
        fromAsset: 'USDC', fromQuantity: 100, fromPriceUsd: 1,
        toAsset: 'USDT', toQuantity: 100, toPriceUsd: 1,
        datetime: '2024-02-01T00:00:00Z',
      }),
    ];

    const report = calculateRomaniaTax(txs, '2024', 4.5);
    expect(report.warnings).toBeDefined();
    expect(report.warnings!.some(w => w.includes('stablecoin-to-stablecoin'))).toBe(true);
  });

  it('withdrawal exceeding cash balance generates warning', () => {
    // No deposits, just a withdrawal
    const txs: Transaction[] = [
      tx({
        type: 'Withdrawal',
        fromAsset: 'USDC', fromQuantity: 500, fromPriceUsd: 1,
        toAsset: 'USD', toQuantity: 500, toPriceUsd: 1,
        datetime: '2024-06-01T00:00:00Z',
      }),
    ];

    const report = calculateRomaniaTax(txs, '2024', 4.5);
    expect(report.warnings).toBeDefined();
    expect(report.warnings!.some(w => w.includes('cash balance is 0'))).toBe(true);
    // Full amount is gain when cost basis is 0
    expect(report.totalGainLossUsd).toBeCloseTo(500, 2);
  });

  it('only withdrawals from target year generate taxable events', () => {
    const txs: Transaction[] = [
      tx({
        type: 'Deposit',
        fromAsset: 'USD', fromQuantity: 1000,
        toAsset: 'USDC', toQuantity: 1000, toPriceUsd: 1,
        datetime: '2023-01-01T00:00:00Z',
      }),
      // 2023 withdrawal - should NOT appear in 2024 report
      tx({
        type: 'Withdrawal',
        fromAsset: 'USDC', fromQuantity: 300, fromPriceUsd: 1,
        toAsset: 'USD', toQuantity: 300, toPriceUsd: 1,
        datetime: '2023-06-01T00:00:00Z',
      }),
      // 2024 withdrawal - should appear in 2024 report
      tx({
        type: 'Withdrawal',
        fromAsset: 'USDC', fromQuantity: 400, fromPriceUsd: 1,
        toAsset: 'USD', toQuantity: 400, toPriceUsd: 1,
        datetime: '2024-03-01T00:00:00Z',
      }),
    ];

    const report = calculateRomaniaTax(txs, '2024', 4.5);
    // Only the 2024 withdrawal should be a taxable event
    expect(report.taxableEvents).toHaveLength(1);
    expect(report.taxableEvents[0].fiatAmountUsd).toBeCloseTo(400, 2);
    // But the 2023 withdrawal should have consumed from the queue
    // Remaining: 1000 - 300 (2023) - 400 (2024) = 300
    expect(report.remainingCashUsd).toBeCloseTo(300, 2);
  });

  it('multiple withdrawals aggregate totals correctly', () => {
    const txs: Transaction[] = [
      tx({
        type: 'Deposit',
        fromAsset: 'USD', fromQuantity: 2000,
        toAsset: 'USDC', toQuantity: 2000, toPriceUsd: 1,
        datetime: '2024-01-01T00:00:00Z',
      }),
      tx({
        type: 'Withdrawal',
        fromAsset: 'USDC', fromQuantity: 500, fromPriceUsd: 1,
        toAsset: 'USD', toQuantity: 500, toPriceUsd: 1,
        datetime: '2024-03-01T00:00:00Z',
      }),
      tx({
        type: 'Withdrawal',
        fromAsset: 'USDC', fromQuantity: 700, fromPriceUsd: 1,
        toAsset: 'USD', toQuantity: 700, toPriceUsd: 1,
        datetime: '2024-06-01T00:00:00Z',
      }),
    ];

    const report = calculateRomaniaTax(txs, '2024', 4.5);
    expect(report.taxableEvents).toHaveLength(2);
    expect(report.totalWithdrawalsUsd).toBeCloseTo(1200, 2);
    expect(report.totalCostBasisUsd).toBeCloseTo(1200, 2);
    expect(report.totalGainLossUsd).toBeCloseTo(0, 2);
    // Verify individual events sum to totals
    const sumGain = report.taxableEvents.reduce((s, e) => s + e.gainLossUsd, 0);
    expect(sumGain).toBeCloseTo(report.totalGainLossUsd, 2);
  });

  it('report totals match event sums', () => {
    const txs: Transaction[] = [
      tx({
        type: 'Deposit',
        fromAsset: 'EUR', fromQuantity: 1000, fromPriceUsd: 1.10,
        toAsset: 'USDC', toQuantity: 1100, toPriceUsd: 1,
        datetime: '2024-01-01T00:00:00Z',
      }),
      tx({
        type: 'Swap',
        fromAsset: 'USDC', fromQuantity: 1100, fromPriceUsd: 1,
        toAsset: 'BTC', toQuantity: 0.02, toPriceUsd: 55000,
        datetime: '2024-02-01T00:00:00Z',
      }),
      tx({
        type: 'Swap',
        fromAsset: 'BTC', fromQuantity: 0.02, fromPriceUsd: 70000,
        toAsset: 'USDC', toQuantity: 1400, toPriceUsd: 1,
        datetime: '2024-06-01T00:00:00Z',
      }),
      tx({
        type: 'Withdrawal',
        fromAsset: 'USDC', fromQuantity: 700, fromPriceUsd: 1,
        toAsset: 'EUR', toQuantity: 636, toPriceUsd: 1.10,
        datetime: '2024-07-01T00:00:00Z',
      }),
      tx({
        type: 'Withdrawal',
        fromAsset: 'USDC', fromQuantity: 700, fromPriceUsd: 1,
        toAsset: 'EUR', toQuantity: 636, toPriceUsd: 1.10,
        datetime: '2024-08-01T00:00:00Z',
      }),
    ];

    const report = calculateRomaniaTax(txs, '2024', 4.5);
    const sumWithdrawals = report.taxableEvents.reduce((s, e) => s + e.fiatAmountUsd, 0);
    const sumCostBasis = report.taxableEvents.reduce((s, e) => s + e.costBasisUsd, 0);
    const sumGainLoss = report.taxableEvents.reduce((s, e) => s + e.gainLossUsd, 0);

    expect(report.totalWithdrawalsUsd).toBeCloseTo(sumWithdrawals, 2);
    expect(report.totalCostBasisUsd).toBeCloseTo(sumCostBasis, 2);
    expect(report.totalGainLossUsd).toBeCloseTo(sumGainLoss, 2);
  });

  it('computes RON amounts using provided USD/RON rate', () => {
    const txs: Transaction[] = [
      tx({
        type: 'Deposit',
        fromAsset: 'USD', fromQuantity: 1000,
        toAsset: 'USDC', toQuantity: 1000, toPriceUsd: 1,
        datetime: '2024-01-01T00:00:00Z',
      }),
      tx({
        type: 'Withdrawal',
        fromAsset: 'USDC', fromQuantity: 500, fromPriceUsd: 1,
        toAsset: 'USD', toQuantity: 500, toPriceUsd: 1,
        datetime: '2024-06-01T00:00:00Z',
      }),
    ];

    const usdToRon = 4.5;
    const report = calculateRomaniaTax(txs, '2024', usdToRon);
    expect(report.usdToRonRate).toBe(4.5);
    // Cost basis RON = cost basis USD * usdToRon
    expect(report.totalCostBasisRon).toBeCloseTo(report.totalCostBasisUsd * usdToRon, 2);
  });
});
