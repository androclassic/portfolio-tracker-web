-- Backfill legacy Crypto.com Exchange imports where stablecoin fees were not
-- applied to the stable leg quantities.
--
-- Idempotence strategy:
-- - BUY rows are updated only when stored spend value still matches gross receive value.
-- - SELL rows are updated only when stored stable proceeds still match gross crypto notional.
-- After this migration runs once, those equalities no longer hold.

-- BUY (stable -> crypto): increase stable spent by fee.
UPDATE "Transaction"
SET "fromQuantity" = COALESCE("fromQuantity", 0) + COALESCE("feesUsd", 0)
WHERE "type" = 'Swap'
  AND COALESCE("feesUsd", 0) > 0
  AND "fromAsset" IN ('USDT', 'USDC', 'USD', 'BUSD', 'DAI')
  AND ("toAsset" IS NULL OR "toAsset" NOT IN ('USDT', 'USDC', 'USD', 'BUSD', 'DAI'))
  AND (
    "importSource" = 'crypto-com-api'
    OR ("importSource" IS NULL AND COALESCE("notes", '') LIKE '%Crypto.com Exchange | %')
  )
  AND INSTR(COALESCE("notes", ''), ' BUY |') > 0
  AND COALESCE("fromPriceUsd", 0) > 0
  AND COALESCE("toPriceUsd", 0) > 0
  AND ABS(
    (COALESCE("toQuantity", 0) * COALESCE("toPriceUsd", 0))
    - (COALESCE("fromQuantity", 0) * COALESCE("fromPriceUsd", 0))
  ) <= 0.0001;

-- SELL (crypto -> stable): reduce stable received by fee and normalize stable price to 1.
UPDATE "Transaction"
SET "toQuantity" = MAX(0, COALESCE("toQuantity", 0) - COALESCE("feesUsd", 0)),
    "toPriceUsd" = 1.0
WHERE "type" = 'Swap'
  AND COALESCE("feesUsd", 0) > 0
  AND "toAsset" IN ('USDT', 'USDC', 'USD', 'BUSD', 'DAI')
  AND ("fromAsset" IS NULL OR "fromAsset" NOT IN ('USDT', 'USDC', 'USD', 'BUSD', 'DAI'))
  AND (
    "importSource" = 'crypto-com-api'
    OR ("importSource" IS NULL AND COALESCE("notes", '') LIKE '%Crypto.com Exchange | %')
  )
  AND INSTR(COALESCE("notes", ''), ' SELL |') > 0
  AND COALESCE("fromPriceUsd", 0) > 0
  AND ABS(
    (COALESCE("fromQuantity", 0) * COALESCE("fromPriceUsd", 0))
    - COALESCE("toQuantity", 0)
  ) <= 0.0001;
