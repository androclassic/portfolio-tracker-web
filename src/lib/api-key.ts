import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

export function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Validate an API key from the X-API-Key header.
 * Returns the userId if valid, or null if invalid/expired/revoked.
 */
export async function validateApiKey(apiKey: string): Promise<{ valid: boolean; userId?: string }> {
  if (!apiKey) {
    return { valid: false };
  }

  const hashedKey = hashApiKey(apiKey);

  const keyRecord = await prisma.apiKey.findFirst({
    where: {
      key: hashedKey,
      revokedAt: null,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    select: {
      id: true,
      userId: true,
    },
  });

  if (!keyRecord) {
    return { valid: false };
  }

  // Update last used timestamp (fire and forget)
  prisma.apiKey.update({
    where: { id: keyRecord.id },
    data: { lastUsedAt: new Date() },
  }).catch(() => {});

  return { valid: true, userId: keyRecord.userId };
}
