import { SUPPORTED_ASSETS } from '@/lib/assets';

const EXTRA_INTEGRATION_SYMBOLS = [
  'AAVE',
  'APT',
  'ARB',
  'ATOM',
  'AUD',
  'AXS',
  'BCH',
  'BONK',
  'BUSD',
  'CAD',
  'CHF',
  'COMP',
  'DASH',
  'DAI',
  'ENS',
  'ETC',
  'FET',
  'FIL',
  'FLOKI',
  'FLOW',
  'FTM',
  'GALA',
  'GBP',
  'GRT',
  'HBAR',
  'INJ',
  'IOTA',
  'JPY',
  'LDO',
  'LTC',
  'MANA',
  'MKR',
  'MLN',
  'NEAR',
  'NEO',
  'ONE',
  'OP',
  'PEPE',
  'REP',
  'RNDR',
  'RPL',
  'SEI',
  'SAND',
  'SHIB',
  'SNX',
  'TIA',
  'USDG',
  'UNI',
  'USDT',
  'VET',
  'WIF',
  'XLM',
  'XMLN',
  'XREP',
  'XTZ',
  'XXBT',
  'XDOGE',
  'XETH',
  'XLTC',
  'XXLM',
  'XXRP',
  'XZEC',
  'ZEC',
  'ZEUR',
  'ZGBP',
  'ZJPY',
  'ZUSD',
] as const;

export const STABLE_FIAT_SYMBOLS = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CAD',
  'AUD',
  'CHF',
  'RON',
] as const;

const INTEGRATION_KNOWN_ASSET_SET = new Set(
  [
    ...SUPPORTED_ASSETS.map((asset) => asset.symbol.toUpperCase()),
    ...EXTRA_INTEGRATION_SYMBOLS,
  ].map((symbol) => symbol.toUpperCase()),
);

export function isKnownIntegrationAsset(symbol: string): boolean {
  return INTEGRATION_KNOWN_ASSET_SET.has(symbol.toUpperCase());
}

export function getUnsupportedIntegrationAssets(
  symbols: Iterable<string>,
  additionalAllowed: readonly string[] = [],
): string[] {
  const allowed = new Set(additionalAllowed.map((s) => s.toUpperCase()));
  const unsupported = new Set<string>();

  for (const raw of symbols) {
    const symbol = raw.trim().toUpperCase();
    if (!symbol) continue;
    if (allowed.has(symbol)) continue;
    if (!isKnownIntegrationAsset(symbol)) {
      unsupported.add(symbol);
    }
  }

  return Array.from(unsupported);
}
