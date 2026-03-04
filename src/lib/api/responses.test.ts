import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  apiSuccess,
  apiCreated,
  apiDeleted,
  apiError,
  apiValidationError,
  apiNotFound,
  apiUnauthorized,
  apiServerError,
} from '@/lib/api/responses';

describe('API response helpers', () => {
  it('apiSuccess returns 200 with data', async () => {
    const res = apiSuccess({ id: 1, name: 'test' });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ id: 1, name: 'test' });
  });

  it('apiSuccess accepts custom status and headers', async () => {
    const res = apiSuccess([], 200, { 'Cache-Control': 'no-cache' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('apiCreated returns 201 with data', async () => {
    const res = apiCreated({ id: 42 });
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ id: 42 });
  });

  it('apiDeleted returns { ok: true }', async () => {
    const res = apiDeleted();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
  });

  it('apiError returns error message with given status', async () => {
    const res = apiError('Invalid name', 400);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'Invalid name' });
  });

  it('apiError defaults to 400', async () => {
    const res = apiError('Bad request');
    expect(res.status).toBe(400);
  });

  it('apiValidationError returns 400 with flattened field errors', async () => {
    const err = new ZodError([
      { code: 'too_small', minimum: 1, type: 'string', inclusive: true, exact: false, message: 'Required', path: ['toAsset'] },
    ]);
    const res = apiValidationError(err);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid request body');
    expect(body.details).toBeDefined();
    expect(body.details.toAsset).toBeDefined();
  });

  it('apiNotFound returns 404 with resource name', async () => {
    const res = apiNotFound('Portfolio');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Portfolio not found' });
  });

  it('apiUnauthorized returns 401', async () => {
    const res = apiUnauthorized();
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('apiServerError returns 500 with Error message', async () => {
    const res = apiServerError(new Error('DB connection failed'));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'DB connection failed' });
  });

  it('apiServerError returns generic message for non-Error', async () => {
    const res = apiServerError('something');
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Internal server error' });
  });
});
