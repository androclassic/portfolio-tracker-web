import crypto from 'crypto';

const API_BASE = 'https://api.crypto.com/exchange/v1/';

export interface CryptoComCredentials {
  apiKey: string;
  apiSecret: string;
}

export interface CryptoComTrade {
  trade_id: string;
  order_id: string;
  instrument_name: string;
  side: 'BUY' | 'SELL';
  traded_price: number | string;
  traded_quantity: number | string;
  fee: number | string;
  fees: number | string;
  fee_currency: string;
  fee_instrument_name: string;
  create_time: number;
  create_time_ns?: string | number;
  transact_time_ns?: string | number;
  liquidity_indicator: string;
}

export interface CryptoComTradeResponse {
  id: number;
  method: string;
  code: number;
  result: {
    data?: CryptoComTrade[];
    trade_list?: CryptoComTrade[];
  };
}

export interface NormalizedTrade {
  externalId: string;
  datetime: string;
  type: 'Deposit' | 'Withdrawal' | 'Swap';
  fromAsset: string;
  fromQuantity: number;
  fromPriceUsd: number | null;
  toAsset: string;
  toQuantity: number;
  toPriceUsd: number | null;
  feesUsd: number | null;
  feeCurrency: string;
  notes: string;
  raw: CryptoComTrade;
}

function buildSignature(
  method: string,
  id: number,
  apiKey: string,
  params: Record<string, unknown>,
  nonce: number,
  apiSecret: string
): string {
  const sortedKeys = Object.keys(params).sort();
  let paramString = '';
  for (const key of sortedKeys) {
    paramString += key + String(params[key]);
  }
  const sigPayload = method + String(id) + apiKey + paramString + String(nonce);
  return crypto
    .createHmac('sha256', apiSecret)
    .update(sigPayload)
    .digest('hex');
}

async function privateRequest<T>(
  creds: CryptoComCredentials,
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const id = Date.now();
  const nonce = Date.now();

  const sig = buildSignature(method, id, creds.apiKey, params, nonce, creds.apiSecret);

  const body = {
    id,
    method,
    api_key: creds.apiKey,
    params,
    nonce,
    sig,
  };

  const res = await fetch(API_BASE + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Crypto.com API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();

  if (json.code !== 0) {
    const msg = json.message || json.code;
    throw new Error(`Crypto.com API error (code ${json.code}): ${msg}`);
  }

  return json as T;
}

export async function testConnection(creds: CryptoComCredentials): Promise<boolean> {
  const resp = await privateRequest<{ code: number }>(
    creds,
    'private/get-account-summary',
    {}
  );
  return resp.code === 0;
}

export async function fetchTrades(
  creds: CryptoComCredentials,
  startTime?: Date,
  endTime?: Date,
  instrumentName?: string
): Promise<CryptoComTrade[]> {
  const end = endTime || new Date();
  const start = startTime || new Date(end.getFullYear(), 0, 1);

  const allTrades: CryptoComTrade[] = [];
  const seenIds = new Set<string>();
  const DAY_MS = 24 * 60 * 60 * 1000;
  const MAX_WINDOW_MS = 7 * DAY_MS; // API docs: max 7-day range
  const LIMIT = 100;

  let windowStartMs = start.getTime();
  const finalEndMs = end.getTime();

  while (windowStartMs < finalEndMs) {
    const windowEndMs = Math.min(windowStartMs + MAX_WINDOW_MS, finalEndMs);
    let cursorEndMs = windowEndMs;
    let pageSafety = 0;

    while (cursorEndMs > windowStartMs && pageSafety < 1000) {
      const params: Record<string, unknown> = {
        start_time: windowStartMs,
        end_time: cursorEndMs,
        limit: LIMIT,
      };
      if (instrumentName) params.instrument_name = instrumentName;

      const resp = await privateRequest<CryptoComTradeResponse>(
        creds,
        'private/get-trades',
        params
      );

      const result = resp.result || {} as Record<string, unknown>;
      const trades = (result.data || result.trade_list || []) as CryptoComTrade[];
      if (trades.length === 0) break;

      for (const t of trades) {
        const id = String(t.trade_id || t.order_id);
        if (!seenIds.has(id)) {
          seenIds.add(id);
          allTrades.push(t);
        }
      }

      const oldestTradeMs = trades.reduce((min, t) => {
        const ts = getTradeTimeMs(t);
        return ts < min ? ts : min;
      }, getTradeTimeMs(trades[0]));

      if (oldestTradeMs >= cursorEndMs) break;
      cursorEndMs = oldestTradeMs;

      if (trades.length < LIMIT) break;
      pageSafety++;
    }

    windowStartMs = windowEndMs;
    if (windowStartMs < finalEndMs) {
      await new Promise(r => setTimeout(r, 80));
    }
  }

  return allTrades.sort((a, b) => Number(a.create_time) - Number(b.create_time));
}

export function normalizeTrades(trades: CryptoComTrade[]): NormalizedTrade[] {
  return trades
    .filter(trade => trade.instrument_name && trade.side)
    .map(trade => {
      const parts = (trade.instrument_name || '').split('_');
      const base = normalizeCryptoComAssetSymbol(parts[0]);
      const quote = normalizeCryptoComAssetSymbol(parts[1]);
      const isBuy = trade.side === 'BUY';

      const tradedQty = num(trade.traded_quantity);
      const tradedPrice = num(trade.traded_price);
      const feeRaw = trade.fees ?? trade.fee ?? 0;
      const fee = Math.abs(num(feeRaw));
      const feeCurrency = normalizeCryptoComAssetSymbol(trade.fee_instrument_name || trade.fee_currency || '');

      const fromAsset = isBuy ? (quote || 'UNKNOWN') : (base || 'UNKNOWN');
      const toAsset = isBuy ? (base || 'UNKNOWN') : (quote || 'UNKNOWN');
      const toQuantity = isBuy ? tradedQty : tradedQty * tradedPrice;
      const fromQuantity = isBuy ? tradedQty * tradedPrice : tradedQty;

      const toPriceUsd = quote && isUsdStable(quote) ? tradedPrice : null;
      const fromPriceUsd = quote && isUsdStable(quote)
        ? (isBuy ? 1 : tradedPrice)
        : null;

      return {
        externalId: String(trade.trade_id || trade.order_id || Date.now()),
        datetime: new Date(trade.create_time).toISOString(),
        type: 'Swap' as const,
        fromAsset,
        fromQuantity,
        fromPriceUsd,
        toAsset,
        toQuantity,
        toPriceUsd,
        feesUsd: feeCurrency && isUsdStable(feeCurrency) && fee > 0 ? fee : null,
        feeCurrency,
        notes: `Crypto.com Exchange | ${trade.instrument_name} ${trade.side} | Trade #${trade.trade_id}`,
        raw: trade,
      };
    });
}

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function getTradeTimeMs(trade: CryptoComTrade): number {
  const ms = Number(trade.create_time);
  if (Number.isFinite(ms) && ms > 0) {
    return ms;
  }

  const ns = trade.create_time_ns;
  if (ns != null && String(ns).trim() !== '') {
    const parsedNs = Number(ns);
    if (Number.isFinite(parsedNs) && parsedNs > 0) {
      return Math.floor(parsedNs / 1_000_000);
    }
  }

  return 0;
}

function normalizeCryptoComAssetSymbol(symbol: string): string {
  const upper = (symbol || '').toUpperCase();
  // On Crypto.com Exchange spot, quote "USD" markets settle in USDC.
  if (upper === 'USD') return 'USDC';
  return upper;
}

function isUsdStable(symbol: string): boolean {
  return ['USDT', 'USDC', 'USD', 'BUSD', 'DAI'].includes(symbol.toUpperCase());
}
