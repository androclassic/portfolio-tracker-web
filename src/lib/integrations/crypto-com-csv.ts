import type { NormalizedTrade } from './crypto-com';

interface CryptoComAppRow {
  Timestamp: string;
  'Transaction Description': string;
  Currency: string;
  Amount: string;
  'To Currency'?: string;
  'To Amount'?: string;
  'Native Currency'?: string;
  'Native Amount'?: string;
  'Transaction Hash'?: string;
}

const TRADE_DESCRIPTIONS = new Set([
  'crypto_purchase',
  'crypto_exchange',
  'viban_purchase',
  'dust_conversion_credited',
  'dust_conversion_debited',
]);

const DEPOSIT_DESCRIPTIONS = new Set([
  'crypto_deposit',
  'fiat_deposit',
  'viban_deposit',
  'rewards_platform_deposit_credited',
  'referral_card_cashback',
  'card_cashback_reverted',
  'reimbursement',
  'crypto_earn_interest_paid',
  'mco_stake_reward',
  'admin_wallet_credited',
  'supercharger_reward_to_app_credited',
  'crypto_earn_program_created',
]);

const WITHDRAWAL_DESCRIPTIONS = new Set([
  'crypto_withdrawal',
  'fiat_withdrawal',
  'viban_card_cashback_reverted',
  'crypto_earn_program_withdrawn',
]);

export function isCryptoComAppCsv(headers: string[]): boolean {
  const normalized = headers.map(h => h.trim());
  return (
    normalized.includes('Timestamp') &&
    normalized.includes('Transaction Description') &&
    normalized.includes('Currency') &&
    normalized.includes('Amount')
  );
}

export function parseCryptoComAppCsv(rows: CryptoComAppRow[]): NormalizedTrade[] {
  const trades: NormalizedTrade[] = [];

  for (const row of rows) {
    const desc = (row['Transaction Description'] || '').trim().toLowerCase();
    const currency = (row.Currency || '').trim().toUpperCase();
    const amount = parseFloat(row.Amount || '0');
    const toCurrency = (row['To Currency'] || '').trim().toUpperCase();
    const toAmount = parseFloat(row['To Amount'] || '0');
    const nativeCurrency = (row['Native Currency'] || '').trim().toUpperCase();
    const nativeAmount = parseFloat(row['Native Amount'] || '0');
    const timestamp = row.Timestamp;

    if (!timestamp || !currency) continue;

    const datetime = parseTimestamp(timestamp);
    if (!datetime) continue;

    const externalId = `cdc-app-${datetime}-${desc}-${currency}-${amount}`;

    if (TRADE_DESCRIPTIONS.has(desc)) {
      if (toCurrency && toAmount) {
        const isBuying = amount < 0;
        trades.push({
          externalId,
          datetime,
          type: 'Swap',
          fromAsset: isBuying ? currency : currency,
          fromQuantity: Math.abs(amount),
          fromPriceUsd: nativeAmount ? Math.abs(nativeAmount) / Math.abs(amount) : null,
          toAsset: toCurrency,
          toQuantity: Math.abs(toAmount),
          toPriceUsd: nativeAmount ? Math.abs(nativeAmount) / Math.abs(toAmount) : null,
          feesUsd: null,
          feeCurrency: nativeCurrency || 'USD',
          notes: `Crypto.com App | ${desc}`,
          raw: row as never,
        });
      }
    } else if (DEPOSIT_DESCRIPTIONS.has(desc)) {
      if (amount > 0) {
        trades.push({
          externalId,
          datetime,
          type: 'Swap' as const,
          fromAsset: '',
          fromQuantity: 0,
          fromPriceUsd: null,
          toAsset: currency,
          toQuantity: amount,
          toPriceUsd: nativeAmount && amount ? Math.abs(nativeAmount) / amount : null,
          feesUsd: null,
          feeCurrency: nativeCurrency || 'USD',
          notes: `Crypto.com App | ${desc}`,
          raw: row as never,
        });
      }
    } else if (WITHDRAWAL_DESCRIPTIONS.has(desc)) {
      if (amount < 0) {
        trades.push({
          externalId,
          datetime,
          type: 'Swap' as const,
          fromAsset: currency,
          fromQuantity: Math.abs(amount),
          fromPriceUsd: nativeAmount && amount ? Math.abs(nativeAmount) / Math.abs(amount) : null,
          toAsset: '',
          toQuantity: 0,
          toPriceUsd: null,
          feesUsd: null,
          feeCurrency: nativeCurrency || 'USD',
          notes: `Crypto.com App | ${desc}`,
          raw: row as never,
        });
      }
    }
  }

  return trades;
}

function parseTimestamp(input: string): string | null {
  const d = new Date(input);
  if (!isNaN(d.getTime())) return d.toISOString();
  return null;
}
