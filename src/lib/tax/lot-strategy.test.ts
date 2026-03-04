import { describe, expect, it } from 'vitest';
import { sortEntriesForStrategy, removeFromLots } from '@/lib/tax/lot-strategy';
import { createFIFOQueue, addToFIFO, type FIFOEntry } from '@/lib/fifo-queue';

function makeEntry(id: number, qty: number, cost: number, date: string): FIFOEntry {
  return { transactionId: id, quantity: qty, costBasisUsd: cost, datetime: date };
}

describe('sortEntriesForStrategy', () => {
  const entries = [
    makeEntry(1, 10, 100, '2024-01-15T00:00:00Z'), // $10/unit
    makeEntry(2, 5, 250, '2024-02-01T00:00:00Z'),   // $50/unit
    makeEntry(3, 8, 80, '2024-01-01T00:00:00Z'),     // $10/unit
  ];

  it('FIFO sorts by time ascending', () => {
    const sorted = sortEntriesForStrategy(entries, 'FIFO');
    expect(sorted.map(e => e.transactionId)).toEqual([3, 1, 2]);
  });

  it('LIFO sorts by time descending', () => {
    const sorted = sortEntriesForStrategy(entries, 'LIFO');
    expect(sorted.map(e => e.transactionId)).toEqual([2, 1, 3]);
  });

  it('HIFO sorts by highest unit cost first', () => {
    const sorted = sortEntriesForStrategy(entries, 'HIFO');
    expect(sorted[0].transactionId).toBe(2); // $50/unit first
  });

  it('LOFO sorts by lowest unit cost first', () => {
    const sorted = sortEntriesForStrategy(entries, 'LOFO');
    // entries 1 and 3 both have $10/unit, but 3 is earlier -> should come first (tie-break)
    expect(sorted[0].transactionId).toBe(3);
    expect(sorted[1].transactionId).toBe(1);
    expect(sorted[2].transactionId).toBe(2); // $50/unit last
  });
});

describe('removeFromLots', () => {
  it('FIFO removes oldest entries first', () => {
    let q = createFIFOQueue('BTC');
    q = addToFIFO(q, 1, 1.0, 40000, '2024-01-01T00:00:00Z');
    q = addToFIFO(q, 2, 1.0, 60000, '2024-02-01T00:00:00Z');

    const { removed, remaining, totalCostBasis } = removeFromLots(q, 1.0, { strategy: 'FIFO' });
    expect(removed).toHaveLength(1);
    expect(removed[0].transactionId).toBe(1); // Oldest
    expect(totalCostBasis).toBeCloseTo(40000);
    expect(remaining.entries).toHaveLength(1);
    expect(remaining.entries[0].transactionId).toBe(2);
  });

  it('LIFO removes newest entries first', () => {
    let q = createFIFOQueue('BTC');
    q = addToFIFO(q, 1, 1.0, 40000, '2024-01-01T00:00:00Z');
    q = addToFIFO(q, 2, 1.0, 60000, '2024-02-01T00:00:00Z');

    const { removed, remaining } = removeFromLots(q, 1.0, { strategy: 'LIFO' });
    expect(removed[0].transactionId).toBe(2); // Newest
    expect(remaining.entries[0].transactionId).toBe(1);
  });

  it('HIFO removes highest cost entries first', () => {
    let q = createFIFOQueue('ETH');
    q = addToFIFO(q, 1, 2.0, 6000, '2024-01-01T00:00:00Z');  // $3000/unit
    q = addToFIFO(q, 2, 1.0, 5000, '2024-02-01T00:00:00Z');  // $5000/unit

    const { removed } = removeFromLots(q, 1.0, { strategy: 'HIFO' });
    expect(removed[0].transactionId).toBe(2); // $5000/unit is higher
  });

  it('partial consumption splits correctly', () => {
    let q = createFIFOQueue('SOL');
    q = addToFIFO(q, 1, 10, 1000, '2024-01-01T00:00:00Z');

    const { removed, remaining, totalCostBasis } = removeFromLots(q, 3, { strategy: 'FIFO' });
    expect(removed[0].quantity).toBeCloseTo(3);
    expect(removed[0].costBasisUsd).toBeCloseTo(300);
    expect(totalCostBasis).toBeCloseTo(300);
    expect(remaining.entries[0].quantity).toBeCloseTo(7);
    expect(remaining.entries[0].costBasisUsd).toBeCloseTo(700);
  });

  it('defaults to FIFO when no strategy specified', () => {
    let q = createFIFOQueue('BTC');
    q = addToFIFO(q, 1, 1.0, 40000, '2024-01-01T00:00:00Z');
    q = addToFIFO(q, 2, 1.0, 60000, '2024-02-01T00:00:00Z');

    const { removed } = removeFromLots(q, 1.0);
    expect(removed[0].transactionId).toBe(1); // FIFO = oldest
  });
});
