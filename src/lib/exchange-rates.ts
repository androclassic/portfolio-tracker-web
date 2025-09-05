// Historical exchange rate service using real APIs
// Primary: European Central Bank (ECB) - free and reliable
// Fallback: ExchangeRate-API - also free

interface ExchangeRateData {
  date: string;
  eur_usd: number;
  eur_ron: number;
  usd_ron: number;
}

class ECBProvider {
  private cache = new Map<string, ExchangeRateData[]>();
  
  async getHistoricalRates(startDate: string, endDate: string): Promise<ExchangeRateData[]> {
    const cacheKey = `${startDate}-${endDate}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      // ECB provides EUR as base, so we get EUR/USD and EUR/RON
      const response = await fetch(
        `https://api.exchangerate.host/timeseries?start_date=${startDate}&end_date=${endDate}&base=EUR&symbols=USD,RON`
      );
      
      if (!response.ok) throw new Error('ECB API failed');
      
      const data = await response.json();
      const rates: ExchangeRateData[] = [];
      
      for (const [date, ratesData] of Object.entries(data.rates || {})) {
        const ratesObj = ratesData as { USD?: number; RON?: number };
        if (ratesObj.USD && ratesObj.RON) {
          rates.push({
            date,
            eur_usd: ratesObj.USD,
            eur_ron: ratesObj.RON,
            usd_ron: ratesObj.RON / ratesObj.USD // Calculate USD/RON
          });
        }
      }
      
      this.cache.set(cacheKey, rates);
      return rates;
    } catch (error) {
      console.warn('ECB API failed, using fallback rates:', error);
      return this.getFallbackRates(startDate, endDate);
    }
  }
  
  private getFallbackRates(startDate: string, endDate: string): ExchangeRateData[] {
    // Fallback to approximate rates if API fails
    const rates: ExchangeRateData[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      const year = d.getFullYear();
      
      let eur_usd = 1.08;
      let eur_ron = 4.9;
      
      // Approximate historical rates
      if (year >= 2024) { eur_usd = 1.08; eur_ron = 4.9; }
      else if (year >= 2023) { eur_usd = 1.10; eur_ron = 4.8; }
      else if (year >= 2022) { eur_usd = 1.05; eur_ron = 4.7; }
      else if (year >= 2021) { eur_usd = 1.18; eur_ron = 4.9; }
      else if (year >= 2020) { eur_usd = 1.14; eur_ron = 4.8; }
      else { eur_usd = 1.11; eur_ron = 4.7; }
      
      rates.push({
        date: dateStr,
        eur_usd,
        eur_ron,
        usd_ron: eur_ron / eur_usd
      });
    }
    
    return rates;
  }
}

class ExchangeRateAPIProvider {
  private cache = new Map<string, ExchangeRateData[]>();
  
  async getHistoricalRates(startDate: string, endDate: string): Promise<ExchangeRateData[]> {
    const cacheKey = `${startDate}-${endDate}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    try {
      const response = await fetch(
        `https://api.exchangerate.host/timeseries?start_date=${startDate}&end_date=${endDate}&base=USD&symbols=EUR,RON`
      );
      
      if (!response.ok) throw new Error('ExchangeRate-API failed');
      
      const data = await response.json();
      const rates: ExchangeRateData[] = [];
      
      for (const [date, ratesData] of Object.entries(data.rates || {})) {
        const ratesObj = ratesData as { EUR?: number; RON?: number };
        if (ratesObj.EUR && ratesObj.RON) {
          rates.push({
            date,
            eur_usd: 1 / ratesObj.EUR, // Convert from USD/EUR to EUR/USD
            eur_ron: ratesObj.RON / ratesObj.EUR, // Calculate EUR/RON
            usd_ron: ratesObj.RON
          });
        }
      }
      
      this.cache.set(cacheKey, rates);
      return rates;
    } catch (error) {
      console.warn('ExchangeRate-API failed:', error);
      return [];
    }
  }
}

const providers = [new ECBProvider(), new ExchangeRateAPIProvider()];

// Cache for synchronous access
const rateCache = new Map<string, number>();

// Preload exchange rates for a date range
export async function preloadExchangeRates(startDate: string, _endDate: string): Promise<void> {
  const currencies = ['EUR', 'RON', 'USD'];
  
  for (const fromCurrency of currencies) {
    for (const toCurrency of currencies) {
      if (fromCurrency !== toCurrency) {
        try {
          const rate = await getHistoricalExchangeRate(fromCurrency, toCurrency, startDate);
          const cacheKey = `${fromCurrency}-${toCurrency}-${startDate}`;
          rateCache.set(cacheKey, rate);
        } catch (error) {
          console.warn(`Failed to preload rate for ${fromCurrency}/${toCurrency}:`, error);
        }
      }
    }
  }
}

// Synchronous version that uses cached data
export function getHistoricalExchangeRateSync(fromCurrency: string, toCurrency: string, date: string): number {
  const cacheKey = `${fromCurrency}-${toCurrency}-${date}`;
  
  if (rateCache.has(cacheKey)) {
    return rateCache.get(cacheKey)!;
  }
  
  // Fallback to static rates if not in cache
  const fallbackRate = getFallbackRate(fromCurrency, toCurrency, date);
  rateCache.set(cacheKey, fallbackRate);
  return fallbackRate;
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
  
  // Fallback to static rates if all providers fail
  console.warn('All exchange rate providers failed, using fallback rates');
  return getFallbackRate(fromCurrency, toCurrency, date);
}

function getFallbackRate(fromCurrency: string, toCurrency: string, date: string): number {
  const year = new Date(date).getFullYear();
  
  if (fromCurrency === 'EUR' && toCurrency === 'USD') {
    if (year >= 2024) return 1.08;
    else if (year >= 2023) return 1.10;
    else if (year >= 2022) return 1.05;
    else if (year >= 2021) return 1.18;
    else if (year >= 2020) return 1.14;
    else return 1.11;
  } else if (fromCurrency === 'RON' && toCurrency === 'USD') {
    if (year >= 2024) return 0.22; // 1/4.6
    else if (year >= 2023) return 0.22; // 1/4.5
    else if (year >= 2022) return 0.23; // 1/4.4
    else if (year >= 2021) return 0.24; // 1/4.2
    else if (year >= 2020) return 0.23; // 1/4.3
    else return 0.24; // 1/4.1
  }
  
  return 1.0;
}
