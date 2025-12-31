// Historical exchange rate service using real APIs (strict: no invented fallbacks).
// Primary: Frankfurter (ECB-based) - free and reliable
// Secondary: ECB eurofxref XML (official ECB feed)

interface ExchangeRateData {
  date: string;
  eur_usd: number;
  eur_ron: number;
  usd_ron: number;
}

type RatesProvider = {
  name: string;
  getHistoricalRates(startDate: string, endDate: string): Promise<ExchangeRateData[]>;
};

class ECBProvider {
  private cache = new Map<string, ExchangeRateData[]>();
  
  async getHistoricalRates(startDate: string, endDate: string): Promise<ExchangeRateData[]> {
    const cacheKey = `${startDate}-${endDate}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // NOTE: name kept for backward compatibility; this now uses the official ECB eurofxref XML feed.
    const response = await fetch('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml');
    if (!response.ok) throw new Error(`ECB XML feed failed: ${response.status} ${response.statusText}`);
    const xml = await response.text();

    const rates: ExchangeRateData[] = [];
    // Parse blocks like: <Cube time='2025-12-12'> ... <Cube currency='USD' rate='1.0'/> ...
    const blockRe = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"][^>]*>([\s\S]*?)<\/Cube>/g;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(xml))) {
      const date = m[1];
      if (date < startDate || date > endDate) continue;
      const inner = m[2];
      const usdMatch = /currency=['"]USD['"]\s+rate=['"]([^'"]+)['"]/.exec(inner);
      const ronMatch = /currency=['"]RON['"]\s+rate=['"]([^'"]+)['"]/.exec(inner);
      if (!usdMatch || !ronMatch) continue;
      const eur_usd = Number(usdMatch[1]);
      const eur_ron = Number(ronMatch[1]);
      if (!Number.isFinite(eur_usd) || !Number.isFinite(eur_ron) || eur_usd <= 0 || eur_ron <= 0) continue;
      rates.push({ date, eur_usd, eur_ron, usd_ron: eur_ron / eur_usd });
    }

    this.cache.set(cacheKey, rates);
    return rates;
  }
}

class FrankfurterProvider {
  private cache = new Map<string, ExchangeRateData[]>();
  
  async getHistoricalRates(startDate: string, endDate: string): Promise<ExchangeRateData[]> {
    const cacheKey = `${startDate}-${endDate}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const response = await fetch(
      `https://api.frankfurter.app/${startDate}..${endDate}?from=EUR&to=USD,RON`
    );
    if (!response.ok) throw new Error(`Frankfurter API failed: ${response.status} ${response.statusText}`);

    const data = await response.json();
    const rates: ExchangeRateData[] = [];
    const byDate = (data && typeof data === 'object' && 'rates' in data) ? (data.rates as Record<string, { USD?: number; RON?: number }>) : {};
    for (const [date, rec] of Object.entries(byDate || {})) {
      const eur_usd = Number(rec?.USD);
      const eur_ron = Number(rec?.RON);
      if (!Number.isFinite(eur_usd) || !Number.isFinite(eur_ron) || eur_usd <= 0 || eur_ron <= 0) continue;
      rates.push({ date, eur_usd, eur_ron, usd_ron: eur_ron / eur_usd });
    }
    this.cache.set(cacheKey, rates);
    return rates;
  }
}

const providers: RatesProvider[] = [
  { name: 'frankfurter', getHistoricalRates: (s, e) => new FrankfurterProvider().getHistoricalRates(s, e) },
  { name: 'ecb-xml', getHistoricalRates: (s, e) => new ECBProvider().getHistoricalRates(s, e) },
];

// Cache for synchronous access
const rateCache = new Map<string, number>();

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function* dateRangeInclusive(startDate: string, endDate: string): Generator<string> {
  const start = new Date(startDate);
  const end = new Date(endDate);
  // Normalize to midnight UTC by using ISO date strings (Date ctor treats YYYY-MM-DD as UTC)
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    yield iso(d);
  }
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate);
  d.setUTCDate(d.getUTCDate() + days);
  return iso(d);
}

function compareISO(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function minISO(a: string, b: string): string {
  return compareISO(a, b) <= 0 ? a : b;
}

function chunkDateRanges(startDate: string, endDate: string, maxDaysInclusive: number): Array<{ start: string; end: string }> {
  const out: Array<{ start: string; end: string }> = [];
  let cur = startDate;
  while (compareISO(cur, endDate) <= 0) {
    const chunkEnd = minISO(addDays(cur, maxDaysInclusive - 1), endDate);
    out.push({ start: cur, end: chunkEnd });
    cur = addDays(chunkEnd, 1);
  }
  return out;
}

// Preload exchange rates for a date range
export async function preloadExchangeRates(startDate: string, endDate: string): Promise<void> {
  // Populate rateCache for every date in the provider result set.
  // This enables strict synchronous lookups later without needing any static fallback.
  let lastErr: unknown = null;
  // Many public FX endpoints struggle with very large timespans; chunk requests to stay reliable.
  // 1 year chunks keeps payload sizes sane and avoids provider-side limits/timeouts.
  const chunks = chunkDateRanges(startDate, endDate, 366);

  for (const provider of providers) {
    try {
      const allRates: ExchangeRateData[] = [];
      for (const c of chunks) {
        const part = await provider.getHistoricalRates(c.start, c.end);
        if (part.length) allRates.push(...part);
      }
      if (!allRates.length) {
        lastErr = new Error(`Provider ${provider.name} returned 0 rates for ${startDate}..${endDate}`);
        continue;
      }

      // Provider data may skip weekends/holidays. We still need a rate for every tx date.
      // We fill missing days by using the closest available real rate within the returned dataset.
      const byDate = new Map<string, ExchangeRateData>();
      for (const r of allRates) byDate.set(r.date, r);

      const pickClosest = (targetISO: string): ExchangeRateData => {
        const exact = byDate.get(targetISO);
        if (exact) return exact;
        const targetTs = new Date(targetISO).getTime();
        let best: ExchangeRateData | null = null;
        let bestDiff = Number.POSITIVE_INFINITY;
        for (const r of allRates) {
          const diff = Math.abs(new Date(r.date).getTime() - targetTs);
          if (diff < bestDiff) {
            best = r;
            bestDiff = diff;
          }
        }
        if (!best) throw new Error(`No FX data available to fill ${targetISO}`);
        return best;
      };

      for (const d of dateRangeInclusive(startDate, endDate)) {
        const r = pickClosest(d);
        const eur_usd = r.eur_usd;
        const eur_ron = r.eur_ron;
        const usd_ron = r.usd_ron;

        // Direct
        rateCache.set(`EUR-USD-${d}`, eur_usd);
        rateCache.set(`EUR-RON-${d}`, eur_ron);
        rateCache.set(`USD-RON-${d}`, usd_ron);

        // Inverse
        if (eur_usd > 0) rateCache.set(`USD-EUR-${d}`, 1 / eur_usd);
        if (eur_ron > 0) rateCache.set(`RON-EUR-${d}`, 1 / eur_ron);
        if (usd_ron > 0) rateCache.set(`RON-USD-${d}`, 1 / usd_ron);
      }

      // First provider that yields data wins
      return;
    } catch (error) {
      lastErr = error;
      console.warn(`Failed to preload exchange rates from provider ${provider.name}:`, error);
      continue;
    }
  }

  const msg = (() => {
    if (lastErr && typeof lastErr === 'object' && 'message' in lastErr) {
      const m = (lastErr as { message?: unknown }).message;
      if (typeof m === 'string') return m;
    }
    return String(lastErr || 'unknown error');
  })();
  throw new Error(`Failed to preload historical FX rates for ${startDate}..${endDate}: ${msg}`);
}

// Synchronous version that uses cached data
export function getHistoricalExchangeRateSync(fromCurrency: string, toCurrency: string, date: string): number {
  if (fromCurrency === toCurrency) return 1.0;
  const cacheKey = `${fromCurrency}-${toCurrency}-${date}`;
  
  if (rateCache.has(cacheKey)) {
    return rateCache.get(cacheKey)!;
  }

  // Backwards-compatible non-strict call sites should preload before using this.
  // We do NOT silently fallback here anymore (money-critical).
  throw new Error(`Missing historical FX rate ${fromCurrency}/${toCurrency} for ${date}. Did you call preloadExchangeRates()?`);
}

// Strict synchronous version (for tax calculations): requires preloadExchangeRates() to have populated the cache.
// Throws if the requested rate is missing to avoid silently wrong money.
export function getHistoricalExchangeRateSyncStrict(fromCurrency: string, toCurrency: string, date: string): number {
  if (fromCurrency === toCurrency) return 1.0;
  const cacheKey = `${fromCurrency}-${toCurrency}-${date}`;
  if (rateCache.has(cacheKey)) return rateCache.get(cacheKey)!;
  throw new Error(
    `Missing historical FX rate ${fromCurrency}/${toCurrency} for ${date}. ` +
      `Did you call preloadExchangeRates(${date}, ...) to cover this day?`
  );
}

// Async version that fetches real data
export async function getHistoricalExchangeRate(
  fromCurrency: string, 
  toCurrency: string, 
  date: string
): Promise<number> {
  if (fromCurrency === toCurrency) return 1.0;
  
  // For single date requests, we'll get a small range around the date
  const startDate = new Date(date);
  startDate.setDate(startDate.getDate() - 7); // Get 7 days before
  const endDate = new Date(date);
  endDate.setDate(endDate.getDate() + 7); // Get 7 days after
  
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = endDate.toISOString().slice(0, 10);
  
  for (const provider of providers) {
    try {
      const rates = await provider.getHistoricalRates(startStr, endStr);
      
      // Find the closest rate to the requested date
      const targetDate = date;
      let closestRate = rates.find(r => r.date === targetDate);
      
      if (!closestRate && rates.length > 0) {
        // Find the closest date
        closestRate = rates.reduce((closest, current) => {
          const closestDiff = Math.abs(new Date(closest.date).getTime() - new Date(targetDate).getTime());
          const currentDiff = Math.abs(new Date(current.date).getTime() - new Date(targetDate).getTime());
          return currentDiff < closestDiff ? current : closest;
        });
      }
      
      if (closestRate) {
        // Convert based on the rate data
        if (fromCurrency === 'EUR' && toCurrency === 'USD') {
          return closestRate.eur_usd;
        } else if (fromCurrency === 'USD' && toCurrency === 'EUR') {
          return 1 / closestRate.eur_usd;
        } else if (fromCurrency === 'RON' && toCurrency === 'USD') {
          return 1 / closestRate.usd_ron;
        } else if (fromCurrency === 'USD' && toCurrency === 'RON') {
          return closestRate.usd_ron;
        } else if (fromCurrency === 'EUR' && toCurrency === 'RON') {
          return closestRate.eur_ron;
        } else if (fromCurrency === 'RON' && toCurrency === 'EUR') {
          return 1 / closestRate.eur_ron;
        }
      }
    } catch (error) {
      console.warn(`Provider failed for ${fromCurrency}/${toCurrency}:`, error);
      continue;
    }
  }

  // Strict: do not silently fallback for money-critical paths.
  throw new Error(`All exchange rate providers failed for ${fromCurrency}/${toCurrency} on ${date}`);
}
