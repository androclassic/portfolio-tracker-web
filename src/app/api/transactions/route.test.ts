import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { makeRequest, makeJsonRequest, mockAuth } from '@/lib/api/test-helpers';

const auth = mockAuth('user_1');

// Mock route-auth to bypass auth and pass our mock auth context
vi.mock('@/lib/api/route-auth', () => ({
  withServerAuthRateLimit: (handler: (req: NextRequest, auth: typeof import('@/lib/api/route-auth').ServerAuthContext) => Promise<Response>) =>
    (req: NextRequest) => handler(req, auth as never),
}));

// Mock cache - TtlCache is used as a constructor (new TtlCache(...))
vi.mock('@/lib/cache', () => ({
  TtlCache: class {
    get() { return null; }
    set() {}
    clear() {}
  },
}));

// Mock logger
vi.mock('@/lib/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

// Mock prices warm-cache
vi.mock('@/lib/prices/warm-cache', () => ({
  warmHistoricalPricesCache: vi.fn().mockResolvedValue(undefined),
}));

const mockPrisma = {
  transaction: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  portfolio: {
    findFirst: vi.fn(),
  },
  $transaction: vi.fn(),
};

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

// Import route handlers AFTER mocks are set up
const { GET, POST, PUT, DELETE: DELETE_HANDLER } = await import('@/app/api/transactions/route');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('transactions API', () => {
  describe('GET', () => {
    it('returns transactions for authenticated user', async () => {
      const txs = [
        { id: 1, type: 'Deposit', toAsset: 'BTC', toQuantity: 0.5, datetime: new Date() },
      ];
      mockPrisma.transaction.findMany.mockResolvedValue(txs);

      const res = await GET(makeRequest('http://localhost/api/transactions'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(mockPrisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            portfolio: { userId: 'user_1' },
          }),
        }),
      );
    });

    it('filters by portfolioId when provided', async () => {
      mockPrisma.transaction.findMany.mockResolvedValue([]);

      await GET(makeRequest('http://localhost/api/transactions?portfolioId=3'));
      expect(mockPrisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ portfolioId: 3 }),
        }),
      );
    });
  });

  describe('POST', () => {
    it('creates a single transaction with valid data', async () => {
      const txData = {
        type: 'Deposit',
        datetime: '2024-01-01T00:00:00Z',
        toAsset: 'BTC',
        toQuantity: 0.5,
        toPriceUsd: 60000,
        portfolioId: 1,
      };
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 1, userId: 'user_1' });
      mockPrisma.$transaction.mockResolvedValue([{ id: 1, ...txData }]);

      const res = await POST(makeJsonRequest('http://localhost/api/transactions', txData));
      expect(res.status).toBe(201);
    });

    it('returns 400 for invalid schema (missing toAsset)', async () => {
      const txData = {
        type: 'Deposit',
        datetime: '2024-01-01T00:00:00Z',
        toQuantity: 0.5,
        portfolioId: 1,
      };

      const res = await POST(makeJsonRequest('http://localhost/api/transactions', txData));
      expect(res.status).toBe(400);
    });

    it('returns 403 when portfolio does not belong to user', async () => {
      const txData = {
        type: 'Deposit',
        datetime: '2024-01-01T00:00:00Z',
        toAsset: 'BTC',
        toQuantity: 0.5,
        portfolioId: 999,
      };
      mockPrisma.portfolio.findFirst.mockResolvedValue(null);

      const res = await POST(makeJsonRequest('http://localhost/api/transactions', txData));
      expect(res.status).toBe(403);
    });

    it('creates batch transactions', async () => {
      const batchData = {
        portfolioId: 1,
        transactions: [
          { type: 'Deposit', datetime: '2024-01-01', toAsset: 'BTC', toQuantity: 0.1, toPriceUsd: 50000 },
          { type: 'Deposit', datetime: '2024-01-02', toAsset: 'ETH', toQuantity: 1.0, toPriceUsd: 3000 },
        ],
      };
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 1, userId: 'user_1' });
      mockPrisma.$transaction.mockResolvedValue([
        { id: 1, ...batchData.transactions[0] },
        { id: 2, ...batchData.transactions[1] },
      ]);

      const res = await POST(makeJsonRequest('http://localhost/api/transactions', batchData));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body).toHaveLength(2);
    });
  });

  describe('PUT', () => {
    it('updates an existing transaction', async () => {
      const updateData = { id: 1, toQuantity: 0.75 };
      mockPrisma.transaction.findFirst.mockResolvedValue({ id: 1, portfolioId: 1 });
      mockPrisma.transaction.update.mockResolvedValue({ id: 1, toQuantity: 0.75 });

      const res = await PUT(makeJsonRequest('http://localhost/api/transactions', updateData, 'PUT'));
      expect(res.status).toBe(200);
    });

    it('returns 404 for non-existent transaction', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(null);

      const res = await PUT(makeJsonRequest('http://localhost/api/transactions', { id: 999, toQuantity: 1 }, 'PUT'));
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid id', async () => {
      const res = await PUT(makeJsonRequest('http://localhost/api/transactions', { id: 'abc' }, 'PUT'));
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE', () => {
    it('deletes a transaction and returns ok', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue({ id: 1, portfolioId: 1 });
      mockPrisma.transaction.delete.mockResolvedValue({ id: 1 });

      const res = await DELETE_HANDLER(makeRequest('http://localhost/api/transactions?id=1'));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true });
    });

    it('returns 404 for non-existent transaction', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(null);

      const res = await DELETE_HANDLER(makeRequest('http://localhost/api/transactions?id=999'));
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid id', async () => {
      const res = await DELETE_HANDLER(makeRequest('http://localhost/api/transactions?id=abc'));
      expect(res.status).toBe(400);
    });
  });
});
