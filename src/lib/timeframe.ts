export type DashboardTimeframe = 'all' | '30d' | '6m' | '1y';

export const DASHBOARD_TIMEFRAMES: Array<{ value: DashboardTimeframe; label: string }> = [
  { value: '30d', label: '30d' },
  { value: '6m', label: '6M' },
  { value: '1y', label: '1Y' },
  { value: 'all', label: 'All' },
];

export function startDateForTimeframe(tf: DashboardTimeframe, now: Date = new Date()): Date | null {
  if (tf === 'all') return null;
  const d = new Date(now);
  if (tf === '30d') {
    d.setDate(d.getDate() - 30);
    return d;
  }
  if (tf === '6m') {
    d.setMonth(d.getMonth() - 6);
    return d;
  }
  if (tf === '1y') {
    d.setFullYear(d.getFullYear() - 1);
    return d;
  }
  return null;
}

export function startIsoForTimeframe(tf: DashboardTimeframe, now: Date = new Date()): string | null {
  const d = startDateForTimeframe(tf, now);
  return d ? d.toISOString().slice(0, 10) : null;
}

export function sliceStartIndexForIsoDates(dates: string[], timeframe: DashboardTimeframe): number {
  const startIso = startIsoForTimeframe(timeframe);
  if (!startIso) return 0;
  // Dates are in YYYY-MM-DD form and typically sorted ascending; lexicographic compare works.
  for (let i = 0; i < dates.length; i++) {
    if (dates[i] >= startIso) return i;
  }
  return dates.length; // nothing in range
}

export function clampDateRangeToTxs(opts: {
  timeframe: DashboardTimeframe;
  txMinUnixSec: number | null;
  nowUnixSec?: number;
}): { start: number; end: number } | null {
  const nowSec = opts.nowUnixSec ?? Math.floor(Date.now() / 1000);
  if (!opts.txMinUnixSec || !Number.isFinite(opts.txMinUnixSec)) return null;

  const tfStart = startDateForTimeframe(opts.timeframe);
  const tfStartSec = tfStart ? Math.floor(tfStart.getTime() / 1000) : null;

  const start = tfStartSec ? Math.max(opts.txMinUnixSec, tfStartSec) : opts.txMinUnixSec;
  const end = nowSec;
  return { start, end };
}

/**
 * Intelligently samples data points to reduce rendering load while maintaining visual quality.
 * Strategy:
 * - Always keeps first and last points
 * - Keeps recent data (last 30 days) at full resolution
 * - Samples evenly from older data
 * - Target: ~50-100 points depending on timeframe
 */
export function sampleDataPoints<T>(
  dates: string[],
  dataArrays: T[][],
  maxPoints: number = 100
): { dates: string[]; dataArrays: T[][] } {
  if (dates.length <= maxPoints) {
    return { dates, dataArrays };
  }

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgoIso = thirtyDaysAgo.toISOString().slice(0, 10);

  // Find the index where recent data starts (last 30 days)
  let recentStartIdx = dates.length - 1;
  for (let i = dates.length - 1; i >= 0; i--) {
    if (dates[i]! < thirtyDaysAgoIso) {
      recentStartIdx = i + 1;
      break;
    }
  }

  const recentCount = dates.length - recentStartIdx;
  const oldCount = recentStartIdx;
  const targetOldPoints = Math.max(1, maxPoints - recentCount - 2); // -2 for first and last

  const indices: number[] = [];
  
  // Always include first point
  indices.push(0);

  // Sample from old data (before recent 30 days)
  if (oldCount > 0 && targetOldPoints > 0) {
    const step = Math.max(1, Math.floor(oldCount / targetOldPoints));
    for (let i = step; i < recentStartIdx; i += step) {
      indices.push(i);
    }
    // Make sure we don't duplicate recentStartIdx if it's already included
    if (indices[indices.length - 1] !== recentStartIdx - 1 && recentStartIdx > 0) {
      indices.push(recentStartIdx - 1);
    }
  }

  // Include all recent data (last 30 days)
  for (let i = recentStartIdx; i < dates.length; i++) {
    if (!indices.includes(i)) {
      indices.push(i);
    }
  }

  // Always include last point
  const lastIdx = dates.length - 1;
  if (!indices.includes(lastIdx)) {
    indices.push(lastIdx);
  }

  // Sort indices to maintain order
  indices.sort((a, b) => a - b);

  // Extract sampled data
  const sampledDates = indices.map(i => dates[i]!);
  const sampledArrays = dataArrays.map(arr => indices.map(i => arr[i]!));

  return { dates: sampledDates, dataArrays: sampledArrays };
}

/**
 * Samples a single data array along with dates
 */
export function sampleDataWithDates<T>(
  dates: string[],
  data: T[],
  maxPoints: number = 100
): { dates: string[]; data: T[] } {
  const result = sampleDataPoints(dates, [data], maxPoints);
  return { dates: result.dates, data: result.dataArrays[0]! };
}


