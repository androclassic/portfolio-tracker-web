import { describe, expect, it } from 'vitest';
import type { CryptoComTrade } from '@/lib/integrations/crypto-com';
import { normalizeTrades } from '@/lib/integrations/crypto-com';

function makeTrade(partial: Partial<CryptoComTrade>): CryptoComTrade {
  return {
    trade_id: '1',
    order_id: 'ord-1',
    instrument_name: 'BTC_USD',
    side: 'BUY',
    traded_price: '50000',
    traded_quantity: '0.01',
    fee: '0',
    fees: '0',
    fee_currency: 'USD',
    fee_instrument_name: 'USD',
    create_time: Date.UTC(2026, 2, 7, 10, 0, 0),
    liquidity_indicator: 'T',
    ...partial,
  };
}

describe('normalizeTrades (Crypto.com)', () => {
  it('deducts stablecoin fee from BUY stable leg', () => {
    const trade = makeTrade({
      side: 'BUY',
      traded_price: '50000',
      traded_quantity: '0.01',
      fees: '2',
      fee_currency: 'USD',
      fee_instrument_name: 'USD',
    });

    const [normalized] = normalizeTrades([trade]);

    expect(normalized).toMatchObject({
      fromAsset: 'USDC',
      fromQuantity: 502,
      fromPriceUsd: 1,
      toAsset: 'BTC',
      toQuantity: 0.01,
      toPriceUsd: 50000,
      feesUsd: 2,
      feeCurrency: 'USDC',
    });
  });

  it('deducts stablecoin fee from SELL stable proceeds', () => {
    const trade = makeTrade({
      side: 'SELL',
      traded_price: '40000',
      traded_quantity: '0.02',
      fees: '1.5',
      fee_currency: 'USD',
      fee_instrument_name: 'USD',
    });

    const [normalized] = normalizeTrades([trade]);

    expect(normalized).toMatchObject({
      fromAsset: 'BTC',
      fromQuantity: 0.02,
      fromPriceUsd: 40000,
      toAsset: 'USDC',
      toQuantity: 798.5,
      toPriceUsd: 1,
      feesUsd: 1.5,
      feeCurrency: 'USDC',
    });
  });

  it('does not adjust stable leg when fee currency is non-stable', () => {
    const trade = makeTrade({
      side: 'SELL',
      traded_price: '1000',
      traded_quantity: '0.5',
      fees: '0.001',
      fee_currency: 'BTC',
      fee_instrument_name: 'BTC',
    });

    const [normalized] = normalizeTrades([trade]);

    expect(normalized).toMatchObject({
      toQuantity: 500,
      toPriceUsd: 1,
      feesUsd: null,
      feeCurrency: 'BTC',
    });
  });

  it('clamps SELL stable proceeds at zero when fee exceeds proceeds', () => {
    const trade = makeTrade({
      side: 'SELL',
      traded_price: '100',
      traded_quantity: '0.01',
      fees: '5',
      fee_currency: 'USD',
      fee_instrument_name: 'USD',
    });

    const [normalized] = normalizeTrades([trade]);
    expect(normalized.toQuantity).toBe(0);
  });
});
