import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerAuth } from '@/lib/auth';
import crypto from 'crypto';

/**
 * Generate a secure API key
 * Format: tk_<32 random hex chars>
 */
function generateApiKey(): string {
  const randomBytes = crypto.randomBytes(32).toString('hex');
  return `tk_${randomBytes}`;
}

/**
 * Hash an API key for secure storage
 */
function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * GET /api/account/api-keys
 * List all API keys for the authenticated user
 */
export async function GET(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKeys = await prisma.apiKey.findMany({
    where: {
      userId: auth.userId,
      revokedAt: null, // Only show active keys
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      lastUsedAt: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ apiKeys });
}

/**
 * POST /api/account/api-keys
 * Create a new API key
 * Body: { name: string }
 */
export async function POST(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const name = body?.name?.trim() || 'API Key';

  if (name.length > 100) {
    return NextResponse.json({ error: 'Name too long (max 100 chars)' }, { status: 400 });
  }

  // Check if user has too many active keys (limit to 5)
  const existingKeysCount = await prisma.apiKey.count({
    where: {
      userId: auth.userId,
      revokedAt: null,
    },
  });

  if (existingKeysCount >= 5) {
    return NextResponse.json(
      { error: 'Maximum of 5 active API keys allowed. Please revoke an existing key first.' },
      { status: 400 }
    );
  }

  // Generate the key
  const plainKey = generateApiKey();
  const hashedKey = hashApiKey(plainKey);
  const keyPrefix = plainKey.substring(0, 11) + '...'; // "tk_abc1234..."

  // Store in database
  const apiKey = await prisma.apiKey.create({
    data: {
      name,
      key: hashedKey,
      keyPrefix,
      userId: auth.userId,
    },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      createdAt: true,
    },
  });

  // Return the plain key ONLY on creation (user must save it)
  return NextResponse.json({
    apiKey: {
      ...apiKey,
      key: plainKey, // Only returned once!
    },
    message: 'API key created. Save this key now - it won\'t be shown again!',
  }, { status: 201 });
}

/**
 * DELETE /api/account/api-keys?id=<keyId>
 * Revoke an API key
 */
export async function DELETE(req: NextRequest) {
  const auth = await getServerAuth(req);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(req.url);
  const keyId = url.searchParams.get('id');

  if (!keyId) {
    return NextResponse.json({ error: 'Missing key id' }, { status: 400 });
  }

  // Find the key and verify ownership
  const apiKey = await prisma.apiKey.findFirst({
    where: {
      id: keyId,
      userId: auth.userId,
      revokedAt: null,
    },
  });

  if (!apiKey) {
    return NextResponse.json({ error: 'API key not found' }, { status: 404 });
  }

  // Soft delete by setting revokedAt
  await prisma.apiKey.update({
    where: { id: keyId },
    data: { revokedAt: new Date() },
  });

  return NextResponse.json({ success: true, message: 'API key revoked' });
}
