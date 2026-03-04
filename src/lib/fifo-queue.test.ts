import { describe, expect, it } from 'vitest';
import { createFIFOQueue, addToFIFO, removeFromFIFO, getFIFOBalance } from '@/lib/fifo-queue';

describe('fifo-queue', () => {
  it('creates an empty queue', () => {
    const q = createFIFOQueue('BTC');
    expect(q.asset).toBe('BTC');
    expect(q.entries).toEqual([]);
  });

  it('adds entries sorted by datetime', () => {
    let q = createFIFOQueue('BTC');
    q = addToFIFO(q, 2, 0.5, 25000, '2024-02-01T00:00:00Z', 'Buy');
    q = addToFIFO(q, 1, 1.0, 50000, '2024-01-01T00:00:00Z', 'Buy');
    expect(q.entries).toHaveLength(2);
    expect(q.entries[0].transactionId).toBe(1); // Earlier date first
    expect(q.entries[1].transactionId).toBe(2);
  });

  it('removes exact quantity (full entry consumed)', () => {
    let q = createFIFOQueue('BTC');
    q = addToFIFO(q, 1, 1.0, 50000, '2024-01-01T00:00:00Z');
    q = addToFIFO(q, 2, 0.5, 30000, '2024-02-01T00:00:00Z');

    const { removed, remaining, totalCostBasis } = removeFromFIFO(q, 1.0);
    expect(removed).toHaveLength(1);
    expect(removed[0].transactionId).toBe(1);
    expect(removed[0].quantity).toBeCloseTo(1.0);
    expect(totalCostBasis).toBeCloseTo(50000);
    expect(remaining.entries).toHaveLength(1);
    expect(remaining.entries[0].transactionId).toBe(2);
  });

  it('splits entry on partial consumption', () => {
    let q = createFIFOQueue('BTC');
    q = addToFIFO(q, 1, 2.0, 100000, '2024-01-01T00:00:00Z');

    const { removed, remaining, totalCostBasis } = removeFromFIFO(q, 0.5);
    expect(removed).toHaveLength(1);
    expect(removed[0].quantity).toBeCloseTo(0.5);
    expect(removed[0].costBasisUsd).toBeCloseTo(25000);
    expect(totalCostBasis).toBeCloseTo(25000);
    expect(remaining.entries).toHaveLength(1);
    expect(remaining.entries[0].quantity).toBeCloseTo(1.5);
    expect(remaining.entries[0].costBasisUsd).toBeCloseTo(75000);
  });

  it('removes across multiple entries', () => {
    let q = createFIFOQueue('ETH');
    q = addToFIFO(q, 1, 1.0, 3000, '2024-01-01T00:00:00Z');
    q = addToFIFO(q, 2, 1.0, 4000, '2024-02-01T00:00:00Z');

    const { removed, remaining, totalCostBasis } = removeFromFIFO(q, 1.5);
    expect(removed).toHaveLength(2);
    expect(totalCostBasis).toBeCloseTo(3000 + 2000); // full first + half second
    expect(remaining.entries).toHaveLength(1);
    expect(remaining.entries[0].quantity).toBeCloseTo(0.5);
  });

  it('calls splitMeta on partial consumption', () => {
    let q = createFIFOQueue('SOL');
    q = addToFIFO(q, 1, 10, 500, '2024-01-01T00:00:00Z', 'Buy', { tag: 'original' });

    const splitMeta = (meta: unknown, ratio: number) => ({
      usedMeta: { ...(meta as Record<string, unknown>), used: ratio },
      remainingMeta: { ...(meta as Record<string, unknown>), remaining: 1 - ratio },
    });

    const { removed, remaining } = removeFromFIFO(q, 3, splitMeta);
    expect((removed[0].meta as { used: number }).used).toBeCloseTo(0.3);
    expect((remaining.entries[0].meta as { remaining: number }).remaining).toBeCloseTo(0.7);
  });

  it('getFIFOBalance returns correct totals', () => {
    let q = createFIFOQueue('ADA');
    q = addToFIFO(q, 1, 100, 50, '2024-01-01T00:00:00Z');
    q = addToFIFO(q, 2, 200, 120, '2024-02-01T00:00:00Z');

    const bal = getFIFOBalance(q);
    expect(bal.quantity).toBeCloseTo(300);
    expect(bal.costBasisUsd).toBeCloseTo(170);
    expect(bal.avgCostBasis).toBeCloseTo(170 / 300);
  });

  it('getFIFOBalance returns zero for empty queue', () => {
    const q = createFIFOQueue('BTC');
    const bal = getFIFOBalance(q);
    expect(bal.quantity).toBe(0);
    expect(bal.costBasisUsd).toBe(0);
    expect(bal.avgCostBasis).toBe(0);
  });
});
