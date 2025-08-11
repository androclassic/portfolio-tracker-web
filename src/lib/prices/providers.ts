import axios from 'axios';

const SYMBOL_TO_COINGECKO: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', ADA: 'cardano', SOL: 'solana', DOT: 'polkadot', XRP: 'ripple', LINK: 'chainlink', AVAX: 'avalanche-2', USDT: 'tether', SUI: 'sui',
};

const SYMBOL_TO_COINCAP: Record<string, string> = {
  BTC: 'bitcoin', ETH: 'ethereum', ADA: 'cardano', SOL: 'solana', DOT: 'polkadot', XRP: 'xrp', LINK: 'chainlink', AVAX: 'avalanche', USDT: 'tether', SUI: 'sui',
};

const SYMBOL_TO_BINANCE_PAIR: Record<string, string> = {
  BTC: 'BTCUSDT', ETH: 'ETHUSDT', ADA: 'ADAUSDT', SOL: 'SOLUSDT', DOT: 'DOTUSDT', XRP: 'XRPUSDT', LINK: 'LINKUSDT', AVAX: 'AVAXUSDT', USDT: 'USDTUSDT', SUI: 'SUIUSDT',
};

export type CurrentPrices = Record<string, number>;
export type HistoricalPoint = { date: string; asset: string; price_usd: number };

export interface PriceProvider {
  name: string;
  getCurrentPrices(symbols: string[]): Promise<CurrentPrices>;
  getHistoricalPrices(symbols: string[], startUnixSec: number, endUnixSec: number): Promise<HistoricalPoint[]>;
}

export class BinanceProvider implements PriceProvider {
  name = 'binance';

  async getCurrentPrices(symbols: string[]): Promise<CurrentPrices> {
    const out: Record<string, number> = {};
    await Promise.all(
      symbols.map(async (sym) => {
        const pair = SYMBOL_TO_BINANCE_PAIR[sym];
        if (!pair) return;
        try {
          const resp = await axios.get('https://api.binance.com/api/v3/ticker/price', {
            params: { symbol: pair },
            timeout: 12000,
          });
          const price = Number(resp.data?.price);
          if (Number.isFinite(price)) out[sym] = price;
        } catch {
          // ignore and let fallback providers handle
        }
      })
    );
    return out;
  }

  async getHistoricalPrices(symbols: string[], startUnixSec: number, endUnixSec: number): Promise<HistoricalPoint[]> {
    const out: HistoricalPoint[] = [];
    await Promise.all(
      symbols.map(async (sym) => {
        const pair = SYMBOL_TO_BINANCE_PAIR[sym];
        if (!pair) return;
        try {
          const resp = await axios.get('https://api.binance.com/api/v3/klines', {
            params: {
              symbol: pair,
              interval: '1d',
              startTime: Math.floor(startUnixSec) * 1000,
              endTime: Math.floor(endUnixSec) * 1000,
            },
            timeout: 15000,
          });
          const klines: unknown[] = resp.data || [];
          for (const k of klines as [number, string, string, string, string, string, number, string, number, string, string, string][]) {
            const closeTimeMs = k[6];
            const closePriceStr = k[4];
            const p = Number(closePriceStr);
            if (!Number.isFinite(p)) continue;
            const date = new Date(closeTimeMs).toISOString().slice(0, 10);
            out.push({ date, asset: sym, price_usd: p });
          }
        } catch {
          // ignore; fallback providers may supply data
        }
      })
    );
    return out;
  }
}

export class CoinGeckoProvider implements PriceProvider {
  name = 'coingecko';

  async getCurrentPrices(symbols: string[]): Promise<CurrentPrices> {
    const ids = symbols.map((s) => SYMBOL_TO_COINGECKO[s]).filter(Boolean);
    if (!ids.length) return {};
    const resp = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
      params: { ids: ids.join(','), vs_currencies: 'usd' },
      timeout: 12000,
    });
    const data = resp.data || {};
    const out: Record<string, number> = {};
    for (const sym of symbols) {
      const id = SYMBOL_TO_COINGECKO[sym];
      const usd = id && data[id]?.usd;
      if (typeof usd === 'number') out[sym] = usd;
    }
    return out;
  }

  async getHistoricalPrices(symbols: string[], startUnixSec: number, endUnixSec: number): Promise<HistoricalPoint[]> {
    const out: HistoricalPoint[] = [];
    for (const sym of symbols) {
      const id = SYMBOL_TO_COINGECKO[sym];
      if (!id) continue;
      const resp = await axios.get(`https://api.coingecko.com/api/v3/coins/${id}/market_chart/range`, {
        params: { vs_currency: 'usd', from: Math.floor(startUnixSec), to: Math.floor(endUnixSec) },
        timeout: 15000,
      });
      const prices: [number, number][] = resp.data?.prices || [];
      for (const [ms, p] of prices) {
        out.push({ date: new Date(ms).toISOString().slice(0, 10), asset: sym, price_usd: p });
      }
    }
    return out;
  }
}

export class CoinCapProvider implements PriceProvider {
  name = 'coincap';

  async getCurrentPrices(symbols: string[]): Promise<CurrentPrices> {
    // CoinCap current price endpoint per asset; batch by parallel requests
    const out: Record<string, number> = {};
    await Promise.all(
      symbols.map(async (sym) => {
        const id = SYMBOL_TO_COINCAP[sym];
        if (!id) return;
        const resp = await axios.get(`https://api.coincap.io/v2/assets/${id}`, { timeout: 12000 });
        const priceUsd = Number(resp.data?.data?.priceUsd);
        if (Number.isFinite(priceUsd)) out[sym] = priceUsd;
      })
    );
    return out;
  }

  async getHistoricalPrices(symbols: string[], startUnixSec: number, endUnixSec: number): Promise<HistoricalPoint[]> {
    // CoinCap historical daily prices
    const out: HistoricalPoint[] = [];
    await Promise.all(
      symbols.map(async (sym) => {
        const id = SYMBOL_TO_COINCAP[sym];
        if (!id) return;
        const resp = await axios.get(`https://api.coincap.io/v2/assets/${id}/history`, {
          params: { interval: 'd1', start: Math.floor(startUnixSec) * 1000, end: Math.floor(endUnixSec) * 1000 },
          timeout: 15000,
        });
        const data: Array<{ priceUsd: string; date: string }> = resp.data?.data || [];
        for (const row of data) {
          const date = row.date.slice(0, 10);
          const p = Number(row.priceUsd);
          if (Number.isFinite(p)) out.push({ date, asset: sym, price_usd: p });
        }
      })
    );
    return out;
  }
}

export const DEFAULT_PROVIDERS: PriceProvider[] = [new BinanceProvider(), new CoinGeckoProvider(), new CoinCapProvider()];


