import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

export function apiSuccess<T>(data: T, status = 200, headers?: Record<string, string>) {
  return NextResponse.json(data, { status, headers });
}

export function apiCreated<T>(data: T) {
  return NextResponse.json(data, { status: 201 });
}

export function apiDeleted() {
  return NextResponse.json({ ok: true });
}

export function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function apiValidationError(zodError: ZodError) {
  return NextResponse.json(
    { error: 'Invalid request body', details: zodError.flatten().fieldErrors },
    { status: 400 },
  );
}

export function apiNotFound(resource = 'Resource') {
  return NextResponse.json({ error: `${resource} not found` }, { status: 404 });
}

export function apiUnauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export function apiServerError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Internal server error';
  return NextResponse.json({ error: message }, { status: 500 });
}
