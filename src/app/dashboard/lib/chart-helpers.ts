/**
 * Shared helpers for dashboard chart components.
 */

/** Get EUR/USD rate from fxRateMap for a given date, falling back to latest or 1.08 */
export function getEURCPrice(
  fxRateMap: Map<string, Record<string, number>>,
  date?: string
): number {
  if (date && fxRateMap.has(date)) {
    const rates = fxRateMap.get(date);
    if (rates && rates['EUR']) return rates['EUR'];
  }
  if (fxRateMap.size > 0) {
    const dates = Array.from(fxRateMap.keys()).sort().reverse();
    for (const d of dates) {
      const rates = fxRateMap.get(d);
      if (rates && rates['EUR']) return rates['EUR'];
    }
  }
  return 1.08;
}

/** Convert hex color to rgba with alpha */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
