import { z } from 'zod';

const importSourceSchema = z.enum([
  'crypto-com-api',
  'crypto-com-csv',
  'kraken-api',
  'kraken-csv',
]);

export const exchangeSchema = z.enum(['crypto-com', 'kraken']);
export const syncExchangeSchema = z.enum(['crypto-com', 'kraken', 'all']);

const positiveInt = z.number().int().positive();
const nonNegativeNumberOrNull = z.number().nonnegative().nullable();

const coercePositiveInt = z.preprocess((value) => {
  if (typeof value === 'string' && value.trim().length > 0) {
    const num = Number(value);
    return Number.isFinite(num) ? Math.trunc(num) : value;
  }
  return value;
}, positiveInt);

const coerceOptionalPositiveIntOrNull = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? Math.trunc(num) : value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : value;
  }
  return value;
}, z.union([positiveInt, z.null()]).optional());

const coerceBoolean = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  }
  return value;
}, z.boolean());

const isoDatetimeString = z.string().min(1).refine((value) => {
  const ts = Date.parse(value);
  return Number.isFinite(ts);
}, {
  message: 'Invalid datetime',
});

const normalizedTradeSchema = z.object({
  externalId: z.string().trim().min(1).max(255),
  datetime: isoDatetimeString,
  type: z.enum(['Deposit', 'Withdrawal', 'Swap']),
  fromAsset: z.string().trim().max(20),
  fromQuantity: z.number().nonnegative(),
  fromPriceUsd: nonNegativeNumberOrNull,
  toAsset: z.string().trim().max(20),
  toQuantity: z.number().nonnegative(),
  toPriceUsd: nonNegativeNumberOrNull,
  feesUsd: nonNegativeNumberOrNull,
  feeCurrency: z.string().trim().max(20).optional(),
  notes: z.string().max(4000).optional(),
  raw: z.unknown().optional(),
});

export const connectionCreateBodySchema = z.object({
  exchange: exchangeSchema,
  apiKey: z.string().trim().min(1).max(512),
  apiSecret: z.string().trim().min(1).max(2048),
  label: z.string().max(120).optional().nullable(),
  portfolioId: coerceOptionalPositiveIntOrNull,
  autoSyncEnabled: coerceBoolean.optional(),
}).strict();

const connectionId = z.preprocess((value) => {
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return value;
}, z.string().trim().min(1).max(191));

export const connectionUpdateBodySchema = z.object({
  id: connectionId.optional(),
  exchange: exchangeSchema.optional(),
  label: z.string().max(120).optional().nullable(),
  portfolioId: coerceOptionalPositiveIntOrNull,
  autoSyncEnabled: coerceBoolean.optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.id && !value.exchange) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['id'],
      message: 'id or exchange is required',
    });
  }
});

export const importRequestBodySchema = z.object({
  trades: z.array(normalizedTradeSchema).min(1).max(10000),
  portfolioId: coercePositiveInt,
  importSource: importSourceSchema.optional(),
}).strict();

export const syncRequestBodySchema = z.object({
  exchange: z.preprocess((value) => {
    if (typeof value === 'string') return value.trim().toLowerCase();
    return value;
  }, syncExchangeSchema).optional().default('all'),
  auto: coerceBoolean.optional().default(false),
  days: z.preprocess((value) => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'string') {
      const num = Number(value);
      return Number.isFinite(num) ? Math.trunc(num) : value;
    }
    if (typeof value === 'number') return Math.trunc(value);
    return value;
  }, z.number().int().min(1).max(30)).optional(),
}).strict();

export const credentialsFetchBodySchema = z.object({
  apiKey: z.string().trim().min(1).max(512).optional(),
  apiSecret: z.string().trim().min(1).max(2048).optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  instrumentName: z.string().trim().max(64).optional(),
}).strict().superRefine((value, ctx) => {
  const hasKey = Boolean(value.apiKey);
  const hasSecret = Boolean(value.apiSecret);
  if (hasKey !== hasSecret) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['apiKey'],
      message: 'Provide both apiKey and apiSecret, or neither',
    });
  }
});
