import type { FIFOEntry, FIFOQueue } from '@/lib/fifo-queue';

export type LotStrategy = 'FIFO' | 'LIFO' | 'HIFO' | 'LOFO';

function unitCost(entry: FIFOEntry): number {
  return entry.quantity > 0 ? entry.costBasisUsd / entry.quantity : 0;
}

export function sortEntriesForStrategy(entries: FIFOEntry[], strategy: LotStrategy): FIFOEntry[] {
  const arr = [...entries];
  const byTimeAsc = (a: FIFOEntry, b: FIFOEntry) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime();
  const byTimeDesc = (a: FIFOEntry, b: FIFOEntry) => -byTimeAsc(a, b);
  const byUnitCostDesc = (a: FIFOEntry, b: FIFOEntry) => {
    const d = unitCost(b) - unitCost(a);
    return d !== 0 ? d : byTimeAsc(a, b);
  };
  const byUnitCostAsc = (a: FIFOEntry, b: FIFOEntry) => {
    const d = unitCost(a) - unitCost(b);
    return d !== 0 ? d : byTimeAsc(a, b);
  };

  switch (strategy) {
    case 'FIFO':
      return arr.sort(byTimeAsc);
    case 'LIFO':
      return arr.sort(byTimeDesc);
    case 'HIFO':
      return arr.sort(byUnitCostDesc);
    case 'LOFO':
      return arr.sort(byUnitCostAsc);
    default:
      return arr.sort(byTimeAsc);
  }
}

/**
 * Consume lots using a selectable strategy (FIFO/LIFO/HIFO/LOFO).
 * This is the "decoupling point" so we can change tax-lot strategy without rewriting the tax engine.
 */
export function removeFromLots(
  queue: FIFOQueue,
  quantity: number,
  opts?: {
    strategy?: LotStrategy;
    splitMeta?: (meta: unknown, ratioUsed: number) => { usedMeta: unknown; remainingMeta: unknown };
  }
): { removed: FIFOEntry[]; remaining: FIFOQueue; totalCostBasis: number } {
  const strategy = opts?.strategy ?? 'FIFO';
  const splitMeta = opts?.splitMeta;

  const ordered = sortEntriesForStrategy(queue.entries, strategy);

  const removed: FIFOEntry[] = [];
  const remainingEntries: FIFOEntry[] = [];
  let remainingQuantity = quantity;
  let totalCostBasis = 0;

  for (const entry of ordered) {
    if (remainingQuantity <= 0) {
      remainingEntries.push(entry);
      continue;
    }

    if (entry.quantity <= remainingQuantity) {
      removed.push(entry);
      totalCostBasis += entry.costBasisUsd;
      remainingQuantity -= entry.quantity;
    } else {
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
    remaining: { ...queue, entries: remainingEntries },
    totalCostBasis,
  };
}


