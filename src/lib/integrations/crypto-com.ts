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
  traded_price: number;
  traded_quantity: number;
  fee: number;
  fee_currency: string;
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
  type: 'Swap';
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
  const allTrades: CryptoComTrade[] = [];
  let page = 0;
  const pageSize = 100;
  const maxPages = 50;

  const params: Record<string, unknown> = {
    page_size: pageSize,
  };

  if (startTime) params.start_ts = startTime.getTime();
  if (endTime) params.end_ts = endTime.getTime();
  if (instrumentName) params.instrument_name = instrumentName;

  while (page < maxPages) {
    params.page = page;

    const resp = await privateRequest<CryptoComTradeResponse>(
      creds,
      'private/get-trades',
      params
    );

    const result = resp.result || {} as Record<string, unknown>;
    const trades = (result.data || result.trade_list || []) as CryptoComTrade[];
    allTrades.push(...trades);

    if (trades.length < pageSize) break;
    page++;
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

      const fromAsset = isBuy ? (quote || 'UNKNOWN') : (base || 'UNKNOWN');
      const toAsset = isBuy ? (base || 'UNKNOWN') : (quote || 'UNKNOWN');
      const toQuantity = isBuy ? trade.traded_quantity : trade.traded_quantity * trade.traded_price;
      const fromQuantity = isBuy ? trade.traded_quantity * trade.traded_price : trade.traded_quantity;

      const toPriceUsd = quote && isUsdStable(quote) ? trade.traded_price : null;
      const fromPriceUsd = quote && isUsdStable(quote)
        ? (isBuy ? 1 : trade.traded_price)
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
        feesUsd: trade.fee_currency && isUsdStable(trade.fee_currency) ? trade.fee : null,
        feeCurrency: trade.fee_currency || '',
        notes: `Crypto.com Exchange | ${trade.instrument_name} ${trade.side} | Trade #${trade.trade_id}`,
        raw: trade,
      };
    });
}

function isUsdStable(symbol: string): boolean {
  return ['USDT', 'USDC', 'USD', 'BUSD', 'DAI'].includes(symbol.toUpperCase());
}
