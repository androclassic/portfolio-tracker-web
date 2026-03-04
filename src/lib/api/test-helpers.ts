import { NextRequest } from 'next/server';

export function mockAuth(userId = 'user_1') {
  return {
    userId,
    user: { id: userId, email: 'test@example.com', name: 'Test User', image: null },
  };
}

export function makeRequest(url = 'http://localhost/api', options?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest(new URL(url), options);
}

export function makeJsonRequest(url: string, body: unknown, method = 'POST') {
  return new NextRequest(new URL(url), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
