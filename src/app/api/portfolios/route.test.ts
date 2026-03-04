import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { makeRequest, makeJsonRequest, mockAuth } from '@/lib/api/test-helpers';

const auth = mockAuth('user_1');

vi.mock('@/lib/api/route-auth', () => ({
  withServerAuthRateLimit: (handler: (req: NextRequest, auth: unknown) => Promise<Response>) =>
    (req: NextRequest) => handler(req, auth),
}));

const mockPrisma = {
  portfolio: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

const { GET, POST, PUT, DELETE: DELETE_HANDLER } = await import('@/app/api/portfolios/route');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('portfolios API', () => {
  describe('GET', () => {
    it('returns portfolios for authenticated user', async () => {
      const portfolios = [
        { id: 1, name: 'Main', userId: 'user_1' },
        { id: 2, name: 'Trading', userId: 'user_1' },
      ];
      mockPrisma.portfolio.findMany.mockResolvedValue(portfolios);

      const res = await GET(makeRequest('http://localhost/api/portfolios'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(2);
      expect(mockPrisma.portfolio.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user_1' } }),
      );
    });
  });

  describe('POST', () => {
    it('creates a portfolio with valid name', async () => {
      mockPrisma.portfolio.create.mockResolvedValue({ id: 3, name: 'New Portfolio', userId: 'user_1' });

      const res = await POST(makeJsonRequest('http://localhost/api/portfolios', { name: 'New Portfolio' }));
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe('New Portfolio');
    });

    it('returns 400 for missing name', async () => {
      const res = await POST(makeJsonRequest('http://localhost/api/portfolios', {}));
      expect(res.status).toBe(400);
    });

    it('returns 400 for non-string name', async () => {
      const res = await POST(makeJsonRequest('http://localhost/api/portfolios', { name: 123 }));
      expect(res.status).toBe(400);
    });
  });

  describe('PUT', () => {
    it('updates portfolio name', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 1, name: 'Old', userId: 'user_1' });
      mockPrisma.portfolio.update.mockResolvedValue({ id: 1, name: 'Updated' });

      const res = await PUT(makeJsonRequest('http://localhost/api/portfolios', { id: 1, name: 'Updated' }, 'PUT'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Updated');
    });

    it('returns 404 for portfolio not belonging to user', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue(null);

      const res = await PUT(makeJsonRequest('http://localhost/api/portfolios', { id: 999, name: 'Test' }, 'PUT'));
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid payload', async () => {
      const res = await PUT(makeJsonRequest('http://localhost/api/portfolios', { id: 'abc' }, 'PUT'));
      expect(res.status).toBe(400);
    });
  });

  describe('DELETE', () => {
    it('deletes a portfolio', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue({ id: 1, userId: 'user_1' });
      mockPrisma.portfolio.delete.mockResolvedValue({ id: 1 });

      const res = await DELETE_HANDLER(makeRequest('http://localhost/api/portfolios?id=1'));
      expect(res.status).toBe(200);
      await expect(res.json()).resolves.toEqual({ ok: true });
    });

    it('returns 404 for portfolio not belonging to user', async () => {
      mockPrisma.portfolio.findFirst.mockResolvedValue(null);

      const res = await DELETE_HANDLER(makeRequest('http://localhost/api/portfolios?id=999'));
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid id', async () => {
      const res = await DELETE_HANDLER(makeRequest('http://localhost/api/portfolios?id=abc'));
      expect(res.status).toBe(400);
    });
  });
});
