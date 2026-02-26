import type { NormalizedTrade } from './crypto-com';
import { isFiatCurrency, isStablecoin } from '../assets';

interface CryptoComAppRow {
  'Timestamp (UTC)'?: string;
  'Timestamp'?: string;
  'Transaction Description'?: string;
  'Currency'?: string;
  'Amount'?: string;
  'To Currency'?: string;
  'To Amount'?: string;
  'Native Currency'?: string;
  'Native Amount'?: string;
  'Native Amount (in USD)'?: string;
  'Transaction Kind'?: string;
  'Transaction Hash'?: string;
}

const BUY_KINDS = new Set([
  'crypto_purchase',
  'trading.crypto_purchase.apple_pay',
  'trading.crypto_purchase',
  'crypto_exchange',
  'viban_purchase',
  'dust_conversion_credited',
  'dust_conversion_debited',
]);

const DEPOSIT_KINDS = new Set([
  'crypto_deposit',
  'rewards_platform_deposit_credited',
  'referral_card_cashback',
  'card_cashback_reverted',
  'reimbursement',
  'crypto_earn_interest_paid',
  'mco_stake_reward',
  'admin_wallet_credited',
  'supercharger_reward_to_app_credited',
  'crypto_earn_program_created',
  'referral_bonus',
  'referral_gift',
  'campaign_reward',
]);

const WITHDRAWAL_KINDS = new Set([
  'crypto_withdrawal',
  'fiat_withdrawal',
  'viban_card_cashback_reverted',
  'crypto_earn_program_withdrawn',
]);

const TRANSFER_KINDS = new Set([
  'crypto_to_exchange_transfer',
  'exchange_to_crypto_transfer',
]);

const SKIP_KINDS = new Set([
  'fiat_deposit',
  'viban_deposit',
  'lockup_lock',
  'lockup_unlock',
  'supercharger_deposit',
  'supercharger_withdrawal',
  'crypto_earn_program_created',
  'crypto_earn_program_withdrawn',
  'stake_reward',
]);

export function isCryptoComAppCsv(headers: string[]): boolean {
  const normalized = headers.map(h => h.trim());
  const hasTimestamp = normalized.includes('Timestamp (UTC)') || normalized.includes('Timestamp');
  const hasCurrency = normalized.includes('Currency');
  const hasAmount = normalized.includes('Amount');
  const hasKindOrDesc = normalized.includes('Transaction Kind') || normalized.includes('Transaction Description');
  return hasTimestamp && hasCurrency && hasAmount && hasKindOrDesc;
}

export interface CsvParseResult {
  trades: NormalizedTrade[];
  warnings: string[];
  skippedKinds: Record<string, number>;
  unsupportedAssets: string[];
}

export function parseCryptoComAppCsv(rows: CryptoComAppRow[]): CsvParseResult {
  const trades: NormalizedTrade[] = [];
  const warnings: string[] = [];
  const skippedKinds: Record<string, number> = {};
  const assetsUsed = new Set<string>();

  for (const row of rows) {
    const kind = (row['Transaction Kind'] || '').trim().toLowerCase();
    const desc = (row['Transaction Description'] || '').trim();
    const currency = (row['Currency'] || '').trim().toUpperCase();
    const amount = parseFloat(row['Amount'] || '0');
    const toCurrency = (row['To Currency'] || '').trim().toUpperCase();
    const toAmount = parseFloat(row['To Amount'] || '0');
    const nativeAmountUsd = parseFloat(row['Native Amount (in USD)'] || row['Native Amount'] || '0');
    const timestamp = row['Timestamp (UTC)'] || row['Timestamp'] || '';

    if (!timestamp || !currency) continue;

    const datetime = parseTimestamp(timestamp);
    if (!datetime) {
      warnings.push(`Row skipped: invalid timestamp "${timestamp}"`);
      continue;
    }

    if (currency) assetsUsed.add(currency);
    if (toCurrency) assetsUsed.add(toCurrency);

    const externalId = `cdc-${datetime}-${kind}-${currency}-${amount}`;

    if (SKIP_KINDS.has(kind)) {
      skippedKinds[kind] = (skippedKinds[kind] || 0) + 1;
      continue;
    }

    if (TRANSFER_KINDS.has(kind)) {
      skippedKinds[kind] = (skippedKinds[kind] || 0) + 1;
      continue;
    }

    if (BUY_KINDS.has(kind) || kind.startsWith('trading.')) {
      if (toCurrency && toAmount) {
        const fromQty = Math.abs(amount);
        const toQty = Math.abs(toAmount);
        const txType = isFiatToStablecoinDeposit(kind, currency, toCurrency) ? 'Deposit' : 'Swap';
        trades.push({
          externalId,
          datetime,
          type: txType,
          fromAsset: currency,
          fromQuantity: fromQty,
          fromPriceUsd: fromQty > 0 ? Math.abs(nativeAmountUsd) / fromQty : null,
          toAsset: toCurrency,
          toQuantity: toQty,
          toPriceUsd: toQty > 0 ? Math.abs(nativeAmountUsd) / toQty : null,
          feesUsd: null,
          feeCurrency: 'USD',
          notes: `Crypto.com App | ${desc}`,
          raw: row as never,
        });
      } else if (amount > 0) {
        trades.push({
          externalId,
          datetime,
          type: 'Swap' as const,
          fromAsset: 'USD',
          fromQuantity: Math.abs(nativeAmountUsd),
          fromPriceUsd: 1,
          toAsset: currency,
          toQuantity: amount,
          toPriceUsd: amount > 0 ? Math.abs(nativeAmountUsd) / amount : null,
          feesUsd: null,
          feeCurrency: 'USD',
          notes: `Crypto.com App | ${desc}`,
          raw: row as never,
        });
      }
    } else if (DEPOSIT_KINDS.has(kind)) {
      if (amount > 0 || (toCurrency && toAmount > 0)) {
        const depositAsset = toCurrency || currency;
        const depositAmount = toCurrency ? Math.abs(toAmount) : Math.abs(amount);
        trades.push({
          externalId,
          datetime,
          type: 'Swap' as const,
          fromAsset: '',
          fromQuantity: 0,
          fromPriceUsd: null,
          toAsset: depositAsset,
          toQuantity: depositAmount,
          toPriceUsd: depositAmount > 0 ? Math.abs(nativeAmountUsd) / depositAmount : null,
          feesUsd: null,
          feeCurrency: 'USD',
          notes: `Crypto.com App | ${desc}`,
          raw: row as never,
        });
      }
    } else if (WITHDRAWAL_KINDS.has(kind)) {
      if (amount < 0) {
        trades.push({
          externalId,
          datetime,
          type: 'Swap' as const,
          fromAsset: currency,
          fromQuantity: Math.abs(amount),
          fromPriceUsd: Math.abs(amount) > 0 ? Math.abs(nativeAmountUsd) / Math.abs(amount) : null,
          toAsset: '',
          toQuantity: 0,
          toPriceUsd: null,
          feesUsd: null,
          feeCurrency: 'USD',
          notes: `Crypto.com App | ${desc}`,
          raw: row as never,
        });
      }
    } else {
      skippedKinds[kind || 'unknown'] = (skippedKinds[kind || 'unknown'] || 0) + 1;
    }
  }

  const knownAssets = getKnownAssets();
  const unsupportedAssets = Array.from(assetsUsed).filter(a => !knownAssets.has(a) && a !== '' && a !== 'USD');

  if (unsupportedAssets.length > 0) {
    warnings.push(`Assets not in price database (prices may be missing): ${unsupportedAssets.join(', ')}`);
  }

  return { trades, warnings, skippedKinds, unsupportedAssets };
}

function parseTimestamp(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T') + 'Z');
  if (!isNaN(d.getTime())) return d.toISOString();
  const d2 = new Date(trimmed);
  if (!isNaN(d2.getTime())) return d2.toISOString();
  return null;
}

function isFiatToStablecoinDeposit(kind: string, fromAsset: string, toAsset: string): boolean {
  return kind === 'viban_purchase' && isFiatCurrency(fromAsset) && isStablecoin(toAsset);
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
    'PEPE', 'WIF', 'BONK', 'FLOKI', 'EURC',
  ]);
}
