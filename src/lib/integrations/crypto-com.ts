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

  let windowStart = start.getTime();
  const finalEnd = end.getTime();

  while (windowStart < finalEnd) {
    const windowEnd = Math.min(windowStart + DAY_MS, finalEnd);

    let page = 0;
    while (page < 20) {
      const params: Record<string, unknown> = {
        start_ts: windowStart,
        end_ts: windowEnd,
        page_size: 100,
        page,
      };
      if (instrumentName) params.instrument_name = instrumentName;

      const resp = await privateRequest<CryptoComTradeResponse>(
        creds,
        'private/get-trades',
        params
      );

      const result = resp.result || {} as Record<string, unknown>;
      const trades = (result.data || result.trade_list || []) as CryptoComTrade[];

      for (const t of trades) {
        const id = String(t.trade_id || t.order_id);
        if (!seenIds.has(id)) {
          seenIds.add(id);
          allTrades.push(t);
        }
      }

      if (trades.length < 100) break;
      page++;
    }

    windowStart = windowEnd;

    // Rate limit: small delay between day windows
    if (windowStart < finalEnd) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  return allTrades;
}

export function normalizeTrades(trades: CryptoComTrade[]): NormalizedTrade[] {
  return trades
    .filter(trade => trade.instrument_name && trade.side)
    .map(trade => {
      const parts = (trade.instrument_name || '').split('_');
      const base = (parts[0] || '').toUpperCase();
      const quote = (parts[1] || '').toUpperCase();
      const isBuy = trade.side === 'BUY';

      const tradedQty = num(trade.traded_quantity);
      const tradedPrice = num(trade.traded_price);
      const feeRaw = trade.fees ?? trade.fee ?? 0;
      const fee = Math.abs(num(feeRaw));
      const feeCurrency = (trade.fee_instrument_name || trade.fee_currency || '').toUpperCase();

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

function isUsdStable(symbol: string): boolean {
  return ['USDT', 'USDC', 'USD', 'BUSD', 'DAI'].includes(symbol.toUpperCase());
}
