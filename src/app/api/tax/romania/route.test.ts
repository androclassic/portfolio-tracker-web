import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { makeRequest, mockAuth } from '@/lib/api/test-helpers';

const auth = mockAuth('user_1');

vi.mock('@/lib/api/route-auth', () => ({
  withServerAuthRateLimit: (handler: (req: NextRequest, auth: unknown) => Promise<Response>) =>
    (req: NextRequest) => handler(req, auth),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockPrisma = {
  transaction: { findMany: vi.fn() },
};
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

const mockCalculateRomaniaTax = vi.fn();
vi.mock('@/lib/tax/romania-v2', () => ({
  calculateRomaniaTax: (...args: unknown[]) => mockCalculateRomaniaTax(...args),
}));

vi.mock('@/lib/exchange-rates', () => ({
  getHistoricalExchangeRate: vi.fn().mockResolvedValue(4.5),
  preloadExchangeRates: vi.fn().mockResolvedValue(undefined),
}));

const { GET } = await import('@/app/api/tax/romania/route');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('tax/romania API', () => {
  it('returns tax report for valid year', async () => {
    const txs = [
      { id: 1, type: 'Deposit', toAsset: 'USDC', toQuantity: 1000, datetime: new Date('2024-01-01'), fromAsset: 'EUR' },
    ];
    mockPrisma.transaction.findMany.mockResolvedValue(txs);
    mockCalculateRomaniaTax.mockReturnValue({
      taxableEvents: [],
      totalGainLossUsd: 0,
      totalWithdrawalsUsd: 0,
      totalCostBasisUsd: 0,
    });

    const res = await GET(makeRequest('http://localhost/api/tax/romania?year=2024'));
    expect(res.status).toBe(200);
    expect(mockCalculateRomaniaTax).toHaveBeenCalledWith(
      expect.any(Array),
      '2024',
      4.5,
      expect.objectContaining({ assetStrategy: 'FIFO', cashStrategy: 'FIFO' }),
    );
  });

  it('returns report for empty transaction set', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([]);
    mockCalculateRomaniaTax.mockReturnValue({
      taxableEvents: [],
      totalGainLossUsd: 0,
      totalWithdrawalsUsd: 0,
      totalCostBasisUsd: 0,
    });

    const res = await GET(makeRequest('http://localhost/api/tax/romania?year=2024'));
    expect(res.status).toBe(200);
  });

  it('passes strategy params correctly', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([]);
    mockCalculateRomaniaTax.mockReturnValue({ taxableEvents: [] });

    await GET(makeRequest('http://localhost/api/tax/romania?year=2024&assetStrategy=LIFO&cashStrategy=HIFO'));
    expect(mockCalculateRomaniaTax).toHaveBeenCalledWith(
      expect.any(Array),
      '2024',
      4.5,
      expect.objectContaining({ assetStrategy: 'LIFO', cashStrategy: 'HIFO' }),
    );
  });

  it('handles calculation errors with 500', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([]);
    mockCalculateRomaniaTax.mockImplementation(() => { throw new Error('Calculation failed'); });

    const res = await GET(makeRequest('http://localhost/api/tax/romania?year=2024'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Calculation failed');
  });
});
