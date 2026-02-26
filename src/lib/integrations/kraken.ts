import crypto from 'crypto';
import type { NormalizedTrade } from './crypto-com';
import { isFiatCurrency, isStablecoin } from '../assets';

// ─── Kraken CSV Parser ──────────────────────────────────────────

interface KrakenCsvRow {
  txid: string;
  refid: string;
  time: string;
  type: string;
  subtype: string;
  aclass: string;
  subclass: string;
  asset: string;
  wallet: string;
  amount: string;
  fee: string;
  balance: string;
}

export function isKrakenCsv(headers: string[]): boolean {
  const h = headers.map(s => s.trim().replace(/"/g, ''));
  return h.includes('txid') && h.includes('refid') && h.includes('aclass') && h.includes('asset');
}

export interface KrakenParseResult {
  trades: NormalizedTrade[];
  warnings: string[];
  skippedTypes: Record<string, number>;
  unsupportedAssets: string[];
}

function normalizeAsset(asset: string): string {
  const a = asset.toUpperCase().replace(/\.HOLD$/, '');
  const map: Record<string, string> = {
    'XXBT': 'BTC', 'XBT': 'BTC',
    'XETH': 'ETH', 'XXRP': 'XRP', 'XLTC': 'LTC', 'XDOGE': 'DOGE',
    'ZUSD': 'USD', 'ZEUR': 'EUR', 'ZGBP': 'GBP', 'ZJPY': 'JPY',
    'XXLM': 'XLM', 'XZEC': 'ZEC', 'XMLN': 'MLN', 'XREP': 'REP',
  };
  return map[a] || a;
}

const SKIP_SUBTYPES = new Set(['delistingconversion']);

export function parseKrakenCsv(rows: KrakenCsvRow[]): KrakenParseResult {
  const trades: NormalizedTrade[] = [];
  const warnings: string[] = [];
  const skippedTypes: Record<string, number> = {};
  const assetsUsed = new Set<string>();

  const byRefid = new Map<string, KrakenCsvRow[]>();
  for (const row of rows) {
    const refid = (row.refid || '').trim();
    if (!refid) continue;
    if (!byRefid.has(refid)) byRefid.set(refid, []);
    byRefid.get(refid)!.push(row);
  }

  for (const [refid, group] of byRefid) {
    const first = group[0];
    const type = (first.type || '').trim().toLowerCase();
    const subtype = (first.subtype || '').trim().toLowerCase();

    if (SKIP_SUBTYPES.has(subtype)) {
      const key = `${type}/${subtype}`;
      skippedTypes[key] = (skippedTypes[key] || 0) + 1;
      continue;
    }

    const spends = group.filter(r => r.type === 'spend');
    const receives = group.filter(r => r.type === 'receive');

    if (spends.length > 0 && receives.length > 0) {
      const spendAssets: { asset: string; amount: number; fee: number }[] = [];
      const receiveAssets: { asset: string; amount: number; fee: number }[] = [];

      for (const s of spends) {
        const asset = normalizeAsset(s.asset);
        const amount = Math.abs(parseFloat(s.amount || '0'));
        const fee = Math.abs(parseFloat(s.fee || '0'));
        spendAssets.push({ asset, amount, fee });
        assetsUsed.add(asset);
      }
      for (const r of receives) {
        const asset = normalizeAsset(r.asset);
        const amount = Math.abs(parseFloat(r.amount || '0'));
        const fee = Math.abs(parseFloat(r.fee || '0'));
        receiveAssets.push({ asset, amount, fee });
        assetsUsed.add(asset);
      }

      const primarySpend = spendAssets.sort((a, b) => b.amount - a.amount)[0];
      const primaryReceive = receiveAssets.sort((a, b) => b.amount - a.amount)[0];

      if (primarySpend && primaryReceive) {
        const datetime = parseKrakenTimestamp(first.time);
        if (!datetime) continue;
        const tradeType = classifyKrakenPairType(primarySpend.asset, primaryReceive.asset);

        trades.push({
          externalId: refid,
          datetime,
          type: tradeType,
          fromAsset: primarySpend.asset,
          fromQuantity: primarySpend.amount,
          fromPriceUsd: null,
          toAsset: primaryReceive.asset,
          toQuantity: primaryReceive.amount,
          toPriceUsd: null,
          feesUsd: null,
          feeCurrency: primarySpend.asset,
          notes: `Kraken | ${primarySpend.asset} → ${primaryReceive.asset} | ${subtype || type}`,
          raw: first as never,
        });
      }
    } else if (type === 'deposit') {
      for (const row of group) {
        const asset = normalizeAsset(row.asset);
        const amount = parseFloat(row.amount || '0');
        const fee = Math.abs(parseFloat(row.fee || '0'));
        if (amount <= 0) continue;
        if (isFiatCurrency(asset)) {
          skippedTypes['deposit/fiat_topup'] = (skippedTypes['deposit/fiat_topup'] || 0) + 1;
          continue;
        }
        assetsUsed.add(asset);

        const datetime = parseKrakenTimestamp(row.time);
        if (!datetime) continue;

        trades.push({
          externalId: row.txid || refid,
          datetime,
          type: 'Swap' as const,
          fromAsset: '',
          fromQuantity: 0,
          fromPriceUsd: null,
          toAsset: asset,
          toQuantity: amount - fee,
          toPriceUsd: null,
          feesUsd: null,
          feeCurrency: asset,
          notes: `Kraken | Deposit ${asset}${fee > 0 ? ` (fee: ${fee})` : ''}`,
          raw: row as never,
        });
      }
    } else if (type === 'withdrawal') {
      for (const row of group) {
        const asset = normalizeAsset(row.asset);
        const amount = Math.abs(parseFloat(row.amount || '0'));
        const fee = Math.abs(parseFloat(row.fee || '0'));
        if (amount <= 0) continue;
        assetsUsed.add(asset);

        const datetime = parseKrakenTimestamp(row.time);
        if (!datetime) continue;

        trades.push({
          externalId: row.txid || refid,
          datetime,
          type: 'Swap' as const,
          fromAsset: asset,
          fromQuantity: amount,
          fromPriceUsd: null,
          toAsset: '',
          toQuantity: 0,
          toPriceUsd: null,
          feesUsd: null,
          feeCurrency: asset,
          notes: `Kraken | Withdrawal ${asset}${fee > 0 ? ` (fee: ${fee})` : ''}`,
          raw: row as never,
        });
      }
    } else if (type === 'reward' || type === 'earn') {
      for (const row of group) {
        const asset = normalizeAsset(row.asset);
        const amount = parseFloat(row.amount || '0');
        if (amount <= 0) continue;
        assetsUsed.add(asset);

        const datetime = parseKrakenTimestamp(row.time);
        if (!datetime) continue;

        trades.push({
          externalId: row.txid || refid,
          datetime,
          type: 'Swap' as const,
          fromAsset: '',
          fromQuantity: 0,
          fromPriceUsd: null,
          toAsset: asset,
          toQuantity: amount,
          toPriceUsd: null,
          feesUsd: null,
          feeCurrency: asset,
          notes: `Kraken | ${subtype || type} reward (${asset})`,
          raw: row as never,
        });
      }
    } else if (type === 'transfer') {
      const key = `${type}/${subtype || 'internal'}`;
      skippedTypes[key] = (skippedTypes[key] || 0) + 1;
    } else {
      const key = type || 'unknown';
      skippedTypes[key] = (skippedTypes[key] || 0) + 1;
    }
  }

  const knownAssets = getKnownAssets();
  const unsupportedAssets = Array.from(assetsUsed).filter(
    a => a && !knownAssets.has(a) && !isStableFiat(a)
  );

  trades.sort((a, b) => new Date(a.datetime).getTime() - new Date(b.datetime).getTime());

  return { trades, warnings, skippedTypes, unsupportedAssets };
}

function parseKrakenTimestamp(input: string): string | null {
  const trimmed = (input || '').trim().replace(/"/g, '');
  if (!trimmed) return null;
  const d = new Date(trimmed.replace(' ', 'T') + 'Z');
  if (!isNaN(d.getTime())) return d.toISOString();
  return null;
}

function classifyKrakenPairType(fromAsset: string, toAsset: string): 'Deposit' | 'Withdrawal' | 'Swap' {
  if (isFiatCurrency(fromAsset) && isStablecoin(toAsset)) return 'Deposit';
  if (isStablecoin(fromAsset) && isFiatCurrency(toAsset)) return 'Withdrawal';
  return 'Swap';
}

function isStableFiat(s: string): boolean {
  return ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'RON'].includes(s);
}

function getKnownAssets(): Set<string> {
  return new Set([
    'BTC', 'ETH', 'SOL', 'ADA', 'DOT', 'LINK', 'AVAX', 'MATIC', 'UNI',
    'ATOM', 'XRP', 'DOGE', 'SHIB', 'LTC', 'BCH', 'ETC', 'FIL', 'NEAR',
    'APT', 'ARB', 'OP', 'SUI', 'SEI', 'TIA', 'INJ', 'FET', 'RNDR',
    'USDC', 'USDT', 'DAI', 'BUSD', 'EUR', 'USD', 'GBP', 'RON',
    'CRO', 'EGLD', 'ALGO', 'VET', 'SAND', 'MANA', 'AXS', 'GALA',
    'AAVE', 'MKR', 'COMP', 'SNX', 'GRT', 'ENS', 'LDO', 'RPL',
    'BNB', 'FTM', 'ONE', 'HBAR', 'ICP', 'FLOW',
    'XLM', 'XTZ', 'NEO', 'IOTA', 'DASH', 'ZEC',
    'PEPE', 'WIF', 'BONK', 'FLOKI', 'EURC', 'USDG', 'NIGHT',
  ]);
}


// ─── Kraken REST API Client ─────────────────────────────────────

const API_BASE = 'https://api.kraken.com';

export interface KrakenCredentials {
  apiKey: string;
  apiSecret: string;
}

async function krakenPrivateRequest<T>(
  creds: KrakenCredentials,
  path: string,
  params: Record<string, string> = {}
): Promise<T> {
  const nonce = Date.now().toString();
  const postData = new URLSearchParams({ nonce, ...params }).toString();

  const sha256Hash = crypto.createHash('sha256').update(nonce + postData).digest();
  const hmacInput = Buffer.concat([Buffer.from(path), sha256Hash]);
  const signature = crypto
    .createHmac('sha256', Buffer.from(creds.apiSecret, 'base64'))
    .update(hmacInput)
    .digest('base64');

  const res = await fetch(API_BASE + path, {
    method: 'POST',
    headers: {
      'API-Key': creds.apiKey,
      'API-Sign': signature,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: postData,
  });

  if (!res.ok) {
    throw new Error(`Kraken API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (json.error && json.error.length > 0) {
    throw new Error(`Kraken API: ${json.error.join(', ')}`);
  }

  return json.result as T;
}

interface KrakenLedgerEntry {
  refid: string;
  time: number;
  type: string;
  subtype: string;
  aclass: string;
  asset: string;
  amount: string;
  fee: string;
  balance: string;
}

export async function fetchKrakenLedger(
  creds: KrakenCredentials,
  start?: Date,
  end?: Date,
): Promise<KrakenCsvRow[]> {
  const allEntries: KrakenCsvRow[] = [];
  let ofs = 0;

  const params: Record<string, string> = {};
  if (start) params.start = String(Math.floor(start.getTime() / 1000));
  if (end) params.end = String(Math.floor(end.getTime() / 1000));

  for (let page = 0; page < 100; page++) {
    params.ofs = String(ofs);

    const result = await krakenPrivateRequest<{
      ledger: Record<string, KrakenLedgerEntry>;
      count: number;
    }>(creds, '/0/private/Ledgers', params);

    const entries = Object.entries(result.ledger || {});
    if (entries.length === 0) break;

    for (const [txid, entry] of entries) {
      allEntries.push({
        txid,
        refid: entry.refid,
        time: new Date(entry.time * 1000).toISOString().replace('T', ' ').slice(0, 19),
        type: entry.type,
        subtype: entry.subtype || '',
        aclass: entry.aclass,
        subclass: '',
        asset: entry.asset,
        wallet: 'spot / main',
        amount: entry.amount,
        fee: entry.fee,
        balance: entry.balance,
      });
    }

    ofs += entries.length;
    if (ofs >= result.count) break;

    await new Promise(r => setTimeout(r, 500));
  }

  return allEntries;
}
