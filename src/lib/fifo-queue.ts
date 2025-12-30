/**
 * Lot queue entry store for tracking holdings and cost basis.
 *
 * Note: despite the file name, the queue can be consumed using different strategies
 * (FIFO/LIFO/HIFO/LOFO) via `src/lib/tax/lot-strategy.ts`.
 */

export interface FIFOEntry<TMeta = unknown> {
  transactionId: number;
  quantity: number;
  costBasisUsd: number;
  datetime: string;
  source?: string; // For tracing back to original purchase
  meta?: TMeta; // Optional structured metadata (e.g., provenance)
}

export interface FIFOQueue<TMeta = unknown> {
  entries: FIFOEntry<TMeta>[];
  asset: string;
}

/**
 * Add a new entry to the FIFO queue (e.g., when buying an asset)
 */
export function addToFIFO(
  queue: FIFOQueue,
  transactionId: number,
  quantity: number,
  costBasisUsd: number,
  datetime: string,
  source?: string,
  meta?: unknown
): FIFOQueue {
  return {
    ...queue,
    entries: [
      ...queue.entries,
      {
        transactionId,
        quantity,
        costBasisUsd,
        datetime,
        source,
        meta,
      },
    ].sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime()),
  };
}

/**
 * Remove quantity from FIFO queue (e.g., when selling an asset)
 * Returns the removed entries and remaining queue
 */
export function removeFromFIFO(
  queue: FIFOQueue,
  quantity: number,
  splitMeta?: (meta: unknown, ratioUsed: number) => { usedMeta: unknown; remainingMeta: unknown }
): {
  removed: FIFOEntry[];
  remaining: FIFOQueue;
  totalCostBasis: number;
} {
  const removed: FIFOEntry[] = [];
  let remainingQuantity = quantity;
  let totalCostBasis = 0;

  const remainingEntries: FIFOEntry[] = [];

  for (const entry of queue.entries) {
    if (remainingQuantity <= 0) {
      remainingEntries.push(entry);
      continue;
    }

    if (entry.quantity <= remainingQuantity) {
      // Use entire entry
      removed.push(entry);
      totalCostBasis += entry.costBasisUsd;
      remainingQuantity -= entry.quantity;
    } else {
      // Split entry
      const usedQuantity = remainingQuantity;
      const usedCostBasis = (entry.costBasisUsd / entry.quantity) * usedQuantity;
      const remainingCostBasis = entry.costBasisUsd - usedCostBasis;
      const ratioUsed = entry.quantity > 0 ? usedQuantity / entry.quantity : 0;

      const usedMeta =
        splitMeta && entry.meta !== undefined ? splitMeta(entry.meta, ratioUsed).usedMeta : entry.meta;
      const remainingMeta =
        splitMeta && entry.meta !== undefined ? splitMeta(entry.meta, ratioUsed).remainingMeta : entry.meta;

      removed.push({
        ...entry,
        quantity: usedQuantity,
        costBasisUsd: usedCostBasis,
        meta: usedMeta,
      });

      remainingEntries.push({
        ...entry,
        quantity: entry.quantity - usedQuantity,
        costBasisUsd: remainingCostBasis,
        meta: remainingMeta,
      });

      totalCostBasis += usedCostBasis;
      remainingQuantity = 0;
    }
  }

  return {
    removed,
    remaining: {
      ...queue,
      entries: remainingEntries,
    },
    totalCostBasis,
  };
}

/**
 * Get current balance and cost basis from FIFO queue
 */
export function getFIFOBalance(queue: FIFOQueue): {
  quantity: number;
  costBasisUsd: number;
  avgCostBasis: number;
} {
  const quantity = queue.entries.reduce((sum, entry) => sum + entry.quantity, 0);
  const costBasisUsd = queue.entries.reduce((sum, entry) => sum + entry.costBasisUsd, 0);
  const avgCostBasis = quantity > 0 ? costBasisUsd / quantity : 0;

  return {
    quantity,
    costBasisUsd,
    avgCostBasis,
  };
}

/**
 * Create a new FIFO queue for an asset
 */
export function createFIFOQueue(asset: string): FIFOQueue {
  return {
    asset,
    entries: [],
  };
}

