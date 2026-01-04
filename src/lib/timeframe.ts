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


