import { useMemo } from 'react';
import type { Transaction as Tx } from '@/lib/types';

export interface DailyPosition {
  date: string;
  asset: string;
  position: number;
}

/**
 * Compute cumulative daily positions and transaction notes from transactions.
 */
export function useDailyPositions(txs: Tx[] | undefined) {
  const dailyPos = useMemo<DailyPosition[]>(() => {
    if (!txs || txs.length === 0) return [];

    const rows: Array<{ asset: string; day: string; signed: number }> = [];
    for (const t of txs) {
      const day = new Date(t.datetime).toISOString().slice(0, 10);
      if (t.type === 'Swap') {
        if (t.toAsset) {
          const toA = t.toAsset.toUpperCase();
          if (toA !== 'USD') rows.push({ asset: toA, day, signed: Math.abs(t.toQuantity) });
        }
        if (t.fromAsset) {
          const fromA = t.fromAsset.toUpperCase();
          if (fromA !== 'USD') rows.push({ asset: fromA, day, signed: -Math.abs(t.fromQuantity || 0) });
        }
      } else if (t.type === 'Deposit') {
        const a = t.toAsset.toUpperCase();
        if (a !== 'USD') rows.push({ asset: a, day, signed: Math.abs(t.toQuantity) });
      } else if (t.type === 'Withdrawal') {
        const a = t.fromAsset?.toUpperCase();
        if (a && a !== 'USD') rows.push({ asset: a, day, signed: -Math.abs(t.fromQuantity || 0) });
      }
    }

    const byKey = new Map<string, number>();
    for (const r of rows) {
      const key = r.day + '|' + r.asset;
      byKey.set(key, (byKey.get(key) || 0) + r.signed);
    }

    const perAsset = new Map<string, { date: string; delta: number }[]>();
    for (const [key, delta] of byKey.entries()) {
      const [d, a] = key.split('|');
      if (!perAsset.has(a)) perAsset.set(a, []);
      perAsset.get(a)!.push({ date: d, delta });
    }

    const result: DailyPosition[] = [];
    for (const [asset, arr] of perAsset.entries()) {
      arr.sort((x, y) => x.date.localeCompare(y.date));
      let cum = 0;
      for (const it of arr) {
        cum += it.delta;
        result.push({ date: it.date, asset, position: cum });
      }
    }
    return result;
  }, [txs]);

  const notesByDayAsset = useMemo(() => {
    const map = new Map<string, string>();
    if (!txs) return map;
    for (const t of txs) {
      const txAssets: string[] = [];
      if (t.fromAsset) txAssets.push(t.fromAsset.toUpperCase());
      if (t.toAsset) txAssets.push(t.toAsset.toUpperCase());
      const day = new Date(new Date(t.datetime).getFullYear(), new Date(t.datetime).getMonth(), new Date(t.datetime).getDate());
      const note = t.notes ? String(t.notes).trim() : '';
      if (!note) continue;
      for (const a of txAssets) {
        const key = day.toISOString().slice(0, 10) + '|' + a;
        const prev = map.get(key);
        map.set(key, prev ? `${prev}\n• ${note}` : `• ${note}`);
      }
    }
    return map;
  }, [txs]);

  return { dailyPos, notesByDayAsset };
}
