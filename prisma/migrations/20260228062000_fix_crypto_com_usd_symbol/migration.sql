-- Crypto.com Exchange "USD" spot quote markets settle in USDC.
-- Backfill previously imported API rows that were stored as fiat USD.
UPDATE "Transaction"
SET "fromAsset" = 'USDC'
WHERE "fromAsset" = 'USD'
  AND (
    "importSource" = 'crypto-com-api'
    OR ("importSource" IS NULL AND "notes" LIKE 'Crypto.com Exchange | %' AND INSTR("notes", '_USD ') > 0)
  );

UPDATE "Transaction"
SET "toAsset" = 'USDC'
WHERE "toAsset" = 'USD'
  AND (
    "importSource" = 'crypto-com-api'
    OR ("importSource" IS NULL AND "notes" LIKE 'Crypto.com Exchange | %' AND INSTR("notes", '_USD ') > 0)
  );
