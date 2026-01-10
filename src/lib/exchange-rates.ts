// Historical exchange rate service using real APIs (strict: no invented fallbacks).
// Primary: Frankfurter (ECB-based) - free and reliable
// Secondary: ECB eurofxref XML (official ECB feed)

import { prisma } from '@/lib/prisma';

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

// Cache for synchronous access (in-memory)
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

/**
 * Load exchange rates from database cache
 * Note: Returns empty map in browser environment (Prisma cannot run in browser)
 */
async function getExchangeRatesFromDB(
  fromCurrency: string,
  toCurrency: string,
  startDate: string,
  endDate: string
): Promise<Map<string, number>> {
  // Skip DB access in browser - Prisma cannot run client-side
  if (typeof window !== 'undefined') {
    return new Map();
  }

  try {
    const cached = await prisma.historicalExchangeRate.findMany({
      where: {
        fromCurrency: fromCurrency.toUpperCase(),
        toCurrency: toCurrency.toUpperCase(),
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: 'asc' },
    });

    const map = new Map<string, number>();
    for (const r of cached) {
      map.set(r.date, r.rate);
    }
    return map;
  } catch (error) {
    console.warn('[FX Rates] Error reading from DB cache:', error);
    return new Map();
  }
}

/**
 * Store exchange rates in database cache
 */
async function storeExchangeRatesInDB(
  fromCurrency: string,
  toCurrency: string,
  rates: Map<string, number>
): Promise<void> {
  if (rates.size === 0) return;

  try {
    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();
    const chunkSize = 100;
    const entries = Array.from(rates.entries());

    for (let i = 0; i < entries.length; i += chunkSize) {
      const chunk = entries.slice(i, i + chunkSize);
      await Promise.all(
        chunk.map(([date, rate]) =>
          prisma.historicalExchangeRate.upsert({
            where: {
              fromCurrency_toCurrency_date: {
                fromCurrency: from,
                toCurrency: to,
                date,
              },
            },
            update: {
              rate,
              updatedAt: new Date(),
            },
            create: {
              fromCurrency: from,
              toCurrency: to,
              date,
              rate,
            },
          })
        )
      );
    }
  } catch (error) {
    console.warn('[FX Rates] Error storing in DB cache:', error);
  }
}

// Preload exchange rates for a date range
export async function preloadExchangeRates(startDate: string, endDate: string): Promise<void> {
  const perfStart = performance.now();
  console.log(`[Performance] 💱 Starting FX rates preload: ${startDate} to ${endDate}`);
  // First, try to load from database cache
  const currencies = ['EUR', 'USD', 'RON'];
  const currencyPairs: Array<{ from: string; to: string }> = [];
  for (const from of currencies) {
    for (const to of currencies) {
      if (from !== to) {
        currencyPairs.push({ from, to });
      }
    }
  }

  // Load all currency pairs from DB
  const dbRates = new Map<string, Map<string, number>>();
  for (const { from, to } of currencyPairs) {
    const rates = await getExchangeRatesFromDB(from, to, startDate, endDate);
    if (rates.size > 0) {
      dbRates.set(`${from}-${to}`, rates);
      // Populate in-memory cache
      for (const [date, rate] of rates.entries()) {
        rateCache.set(`${from}-${to}-${date}`, rate);
        // Also cache inverse
        if (rate > 0) {
          rateCache.set(`${to}-${from}-${date}`, 1 / rate);
        }
      }
    }
  }

  // Check if we have complete coverage
  const requestedDates = new Set<string>();
  for (const d of dateRangeInclusive(startDate, endDate)) {
    requestedDates.add(d);
  }

  // Check if we need to fetch missing rates
  let needsFetch = false;
  for (const { from, to } of currencyPairs) {
    const key = `${from}-${to}`;
    const cached = dbRates.get(key) || new Map();
    for (const date of requestedDates) {
      if (!cached.has(date)) {
        needsFetch = true;
        break;
      }
    }
    if (needsFetch) break;
  }

  // If we have all rates cached, return early
  if (!needsFetch && dbRates.size > 0) {
    const perfEnd = performance.now();
    const duration = perfEnd - perfStart;
    const durationSec = (duration / 1000).toFixed(2);
    console.log(`[Performance] 💱 FX rates: all from DB cache in ${duration.toFixed(2)}ms (${durationSec}s)`);
    return;
  }

  // Track which dates still need to be fetched
  const missingDates = new Set<string>();
  for (const { from, to } of currencyPairs) {
    const key = `${from}-${to}`;
    const cached = dbRates.get(key) || new Map();
    for (const date of requestedDates) {
      if (!cached.has(date)) {
        missingDates.add(date);
      }
    }
  }

  // If no dates are missing, we're done
  if (missingDates.size === 0) {
    return;
  }

  // Find the date range of missing dates
  const missingDateArray = Array.from(missingDates).sort();
  const missingStartDate = missingDateArray[0];
  const missingEndDate = missingDateArray[missingDateArray.length - 1];

  console.log(`[FX Rates] Fetching missing rates for ${missingDates.size} dates (${missingStartDate} to ${missingEndDate})`);

  // Many public FX endpoints struggle with very large timespans; chunk requests to stay reliable.
  // 1 year chunks keeps payload sizes sane and avoids provider-side limits/timeouts.
  const chunks = chunkDateRanges(missingStartDate, missingEndDate, 366);
  let lastErr: unknown = null;
  let anyProviderSucceeded = false;

  // Try all providers until we get complete coverage
  for (const provider of providers) {
    try {
      const allRates: ExchangeRateData[] = [];
      for (const c of chunks) {
        try {
          const part = await provider.getHistoricalRates(c.start, c.end);
          if (part.length) allRates.push(...part);
          // Add a small delay between chunks to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (chunkError) {
          console.warn(`[FX Rates] Provider ${provider.name} failed for chunk ${c.start}..${c.end}:`, chunkError);
          // Continue with other chunks
        }
      }

      if (!allRates.length) {
        lastErr = new Error(`Provider ${provider.name} returned 0 rates for ${missingStartDate}..${missingEndDate}`);
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

      // Store rates in memory cache and prepare for DB storage
      const ratesToStore = new Map<string, Map<string, number>>();
      // Direct pairs
      ratesToStore.set('EUR-USD', new Map());
      ratesToStore.set('EUR-RON', new Map());
      ratesToStore.set('USD-RON', new Map());
      // Inverse pairs
      ratesToStore.set('USD-EUR', new Map());
      ratesToStore.set('RON-EUR', new Map());
      ratesToStore.set('RON-USD', new Map());

      let newlyFetchedCount = 0;
      for (const d of dateRangeInclusive(missingStartDate, missingEndDate)) {
        // Only process dates that are actually missing
        if (!missingDates.has(d)) continue;

        const r = pickClosest(d);
        const eur_usd = r.eur_usd;
        const eur_ron = r.eur_ron;
        const usd_ron = r.usd_ron;

        // Direct
        rateCache.set(`EUR-USD-${d}`, eur_usd);
        rateCache.set(`EUR-RON-${d}`, eur_ron);
        rateCache.set(`USD-RON-${d}`, usd_ron);

        // Inverse
        if (eur_usd > 0) {
          rateCache.set(`USD-EUR-${d}`, 1 / eur_usd);
          ratesToStore.get('USD-EUR')!.set(d, 1 / eur_usd);
        }
        if (eur_ron > 0) {
          rateCache.set(`RON-EUR-${d}`, 1 / eur_ron);
          ratesToStore.get('RON-EUR')!.set(d, 1 / eur_ron);
        }
        if (usd_ron > 0) {
          rateCache.set(`RON-USD-${d}`, 1 / usd_ron);
          ratesToStore.get('RON-USD')!.set(d, 1 / usd_ron);
        }

        // Store direct rates
        ratesToStore.get('EUR-USD')!.set(d, eur_usd);
        ratesToStore.get('EUR-RON')!.set(d, eur_ron);
        ratesToStore.get('USD-RON')!.set(d, usd_ron);

        newlyFetchedCount++;
      }

      // Store in database (only on server-side, skip in browser)
      // Note: Prisma cannot run in browser, so we skip DB storage when called from client
      if (typeof window === 'undefined') {
        const storePromises: Promise<void>[] = [];
        for (const [pair, rates] of ratesToStore.entries()) {
          const [from, to] = pair.split('-');
          if (from && to && rates.size > 0) {
            storePromises.push(
              storeExchangeRatesInDB(from, to, rates).catch(err => {
                console.warn(`[FX Rates] Failed to store ${pair} in DB:`, err);
              })
            );
          }
        }
        await Promise.all(storePromises);
      } else {
        // In browser, we only use in-memory cache (rateCache)
        console.log(`[FX Rates] Skipping DB storage (browser environment), using in-memory cache only`);
      }

      console.log(`[FX Rates] Provider ${provider.name} fetched ${newlyFetchedCount} missing rates`);

      // Update missing dates - remove dates we just fetched
      for (const d of dateRangeInclusive(missingStartDate, missingEndDate)) {
        if (missingDates.has(d)) {
          // Check if we now have all currency pairs for this date
          let allPairsPresent = true;
          for (const { from, to } of currencyPairs) {
            const key = `${from}-${to}-${d}`;
            if (!rateCache.has(key)) {
              allPairsPresent = false;
              break;
            }
          }
          if (allPairsPresent) {
            missingDates.delete(d);
          }
        }
      }

      anyProviderSucceeded = true;

      // If we've covered all missing dates, we're done
      if (missingDates.size === 0) {
        console.log(`[FX Rates] Successfully fetched all missing rates`);
        return;
      }

      // Continue to next provider to fill remaining gaps
    } catch (error) {
      lastErr = error;
      console.warn(`[FX Rates] Provider ${provider.name} failed:`, error);
      continue;
    }
  }

  // If we got some data but not all, that's better than nothing
  if (anyProviderSucceeded && missingDates.size < requestedDates.size) {
    console.warn(`[FX Rates] Fetched partial data: ${missingDates.size} dates still missing out of ${requestedDates.size} total`);
    return;
  }

  // If no provider succeeded at all, throw an error
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
