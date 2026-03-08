import { describe, expect, it } from 'vitest';
import { getAssetIconUrl } from '@/lib/assets';

describe('asset icon URLs', () => {
  it('returns a deterministic local URL for a known symbol', () => {
    const urls = getAssetIconUrl('BTC', 40);
    expect(urls).toEqual([
      '/coin-logos/btc.png?v=40',
    ]);
  });

  it('maps symbol aliases to the expected logo key', () => {
    const urls = getAssetIconUrl('POL', 48);
    expect(urls[0]).toBe('/coin-logos/matic.png?v=48');
  });

  it('returns no URLs for unsupported symbols so UI can fallback', () => {
    expect(getAssetIconUrl('EURC')).toEqual([]);
    expect(getAssetIconUrl('NIGHT')).toEqual([]);
    expect(getAssetIconUrl('UNKNOWN_TOKEN')).toEqual([]);
  });

  it('bounds requested icon size to a sane range', () => {
    expect(getAssetIconUrl('ETH', -1)[0]).toBe('/coin-logos/eth.png?v=16');
    expect(getAssetIconUrl('ETH', 999)[0]).toBe('/coin-logos/eth.png?v=256');
  });
});
