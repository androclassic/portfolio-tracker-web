-- Demo data: 8 months of diverse crypto transactions
DELETE FROM "Transaction" WHERE portfolioId = 1;

-- June 2025: Initial buys
INSERT INTO "Transaction" (type, datetime, fromAsset, fromQuantity, fromPriceUsd, toAsset, toQuantity, toPriceUsd, portfolioId, createdAt, updatedAt) VALUES
('Swap', '2025-06-15 10:00:00', 'USDC', 15000, 1.0, 'BTC', 0.22, 68000, 1, datetime('now'), datetime('now')),
('Swap', '2025-06-15 10:05:00', 'USDC', 8000, 1.0, 'ETH', 2.2, 3600, 1, datetime('now'), datetime('now')),
('Swap', '2025-06-20 14:00:00', 'USDC', 5000, 1.0, 'SOL', 33, 150, 1, datetime('now'), datetime('now')),
('Deposit', '2025-06-25 09:00:00', NULL, NULL, NULL, 'USDC', 20000, 1.0, 1, datetime('now'), datetime('now'));

-- July 2025: More accumulation + first sells
INSERT INTO "Transaction" (type, datetime, fromAsset, fromQuantity, fromPriceUsd, toAsset, toQuantity, toPriceUsd, portfolioId, createdAt, updatedAt) VALUES
('Swap', '2025-07-05 11:00:00', 'USDC', 6000, 1.0, 'BTC', 0.085, 70500, 1, datetime('now'), datetime('now')),
('Swap', '2025-07-10 15:00:00', 'USDC', 4000, 1.0, 'ETH', 1.05, 3800, 1, datetime('now'), datetime('now')),
('Swap', '2025-07-18 09:30:00', 'USDC', 3000, 1.0, 'LINK', 200, 15, 1, datetime('now'), datetime('now')),
('Swap', '2025-07-25 16:00:00', 'SOL', 10, 165, 'USDC', 1650, 1.0, 1, datetime('now'), datetime('now'));

-- August 2025: Market dip — buying more
INSERT INTO "Transaction" (type, datetime, fromAsset, fromQuantity, fromPriceUsd, toAsset, toQuantity, toPriceUsd, portfolioId, createdAt, updatedAt) VALUES
('Swap', '2025-08-03 10:00:00', 'USDC', 10000, 1.0, 'BTC', 0.16, 62000, 1, datetime('now'), datetime('now')),
('Swap', '2025-08-10 12:00:00', 'USDC', 5000, 1.0, 'ETH', 1.6, 3100, 1, datetime('now'), datetime('now')),
('Swap', '2025-08-15 14:00:00', 'USDC', 2000, 1.0, 'ADA', 5000, 0.40, 1, datetime('now'), datetime('now')),
('Deposit', '2025-08-20 09:00:00', NULL, NULL, NULL, 'USDC', 15000, 1.0, 1, datetime('now'), datetime('now'));

-- September 2025: Recovery trades
INSERT INTO "Transaction" (type, datetime, fromAsset, fromQuantity, fromPriceUsd, toAsset, toQuantity, toPriceUsd, portfolioId, createdAt, updatedAt) VALUES
('Swap', '2025-09-01 10:00:00', 'USDC', 7000, 1.0, 'ETH', 2.0, 3500, 1, datetime('now'), datetime('now')),
('Swap', '2025-09-08 11:00:00', 'USDC', 4000, 1.0, 'SOL', 25, 160, 1, datetime('now'), datetime('now')),
('Swap', '2025-09-15 13:00:00', 'ADA', 2000, 0.45, 'USDC', 900, 1.0, 1, datetime('now'), datetime('now')),
('Swap', '2025-09-22 15:00:00', 'USDC', 3000, 1.0, 'LINK', 175, 17, 1, datetime('now'), datetime('now'));

-- October 2025: Bull run begins
INSERT INTO "Transaction" (type, datetime, fromAsset, fromQuantity, fromPriceUsd, toAsset, toQuantity, toPriceUsd, portfolioId, createdAt, updatedAt) VALUES
('Swap', '2025-10-05 10:00:00', 'USDC', 8000, 1.0, 'BTC', 0.105, 76000, 1, datetime('now'), datetime('now')),
('Swap', '2025-10-12 14:00:00', 'USDC', 5000, 1.0, 'ETH', 1.25, 4000, 1, datetime('now'), datetime('now')),
('Swap', '2025-10-20 09:00:00', 'LINK', 100, 20, 'USDC', 2000, 1.0, 1, datetime('now'), datetime('now')),
('Deposit', '2025-10-28 09:00:00', NULL, NULL, NULL, 'USDC', 10000, 1.0, 1, datetime('now'), datetime('now'));

-- November 2025: Peak and profit-taking
INSERT INTO "Transaction" (type, datetime, fromAsset, fromQuantity, fromPriceUsd, toAsset, toQuantity, toPriceUsd, portfolioId, createdAt, updatedAt) VALUES
('Swap', '2025-11-05 10:00:00', 'BTC', 0.1, 85000, 'USDC', 8500, 1.0, 1, datetime('now'), datetime('now')),
('Swap', '2025-11-10 12:00:00', 'USDC', 6000, 1.0, 'SOL', 28, 215, 1, datetime('now'), datetime('now')),
('Swap', '2025-11-18 14:00:00', 'ETH', 1.0, 4200, 'USDC', 4200, 1.0, 1, datetime('now'), datetime('now')),
('Swap', '2025-11-25 16:00:00', 'USDC', 3000, 1.0, 'ADA', 4500, 0.67, 1, datetime('now'), datetime('now'));

-- December 2025: Year-end rebalancing
INSERT INTO "Transaction" (type, datetime, fromAsset, fromQuantity, fromPriceUsd, toAsset, toQuantity, toPriceUsd, portfolioId, createdAt, updatedAt) VALUES
('Swap', '2025-12-05 10:00:00', 'USDC', 10000, 1.0, 'BTC', 0.11, 91000, 1, datetime('now'), datetime('now')),
('Swap', '2025-12-12 11:00:00', 'SOL', 20, 230, 'USDC', 4600, 1.0, 1, datetime('now'), datetime('now')),
('Swap', '2025-12-18 15:00:00', 'USDC', 5000, 1.0, 'ETH', 1.3, 3850, 1, datetime('now'), datetime('now')),
('Withdrawal', '2025-12-28 09:00:00', NULL, NULL, NULL, 'USDC', 5000, 1.0, 1, datetime('now'), datetime('now'));

-- January 2026: New year accumulation
INSERT INTO "Transaction" (type, datetime, fromAsset, fromQuantity, fromPriceUsd, toAsset, toQuantity, toPriceUsd, portfolioId, createdAt, updatedAt) VALUES
('Deposit', '2026-01-05 09:00:00', NULL, NULL, NULL, 'USDC', 12000, 1.0, 1, datetime('now'), datetime('now')),
('Swap', '2026-01-10 10:00:00', 'USDC', 8000, 1.0, 'BTC', 0.082, 97500, 1, datetime('now'), datetime('now')),
('Swap', '2026-01-15 14:00:00', 'USDC', 4000, 1.0, 'ETH', 1.15, 3480, 1, datetime('now'), datetime('now')),
('Swap', '2026-01-22 11:00:00', 'USDC', 3000, 1.0, 'SOL', 14, 215, 1, datetime('now'), datetime('now')),
('Swap', '2026-01-28 16:00:00', 'LINK', 150, 22, 'USDC', 3300, 1.0, 1, datetime('now'), datetime('now'));

-- February 2026: Recent trades
INSERT INTO "Transaction" (type, datetime, fromAsset, fromQuantity, fromPriceUsd, toAsset, toQuantity, toPriceUsd, portfolioId, createdAt, updatedAt) VALUES
('Swap', '2026-02-03 10:00:00', 'USDC', 5000, 1.0, 'BTC', 0.052, 96000, 1, datetime('now'), datetime('now')),
('Swap', '2026-02-08 12:00:00', 'USDC', 3000, 1.0, 'ETH', 1.1, 2730, 1, datetime('now'), datetime('now')),
('Swap', '2026-02-14 15:00:00', 'ADA', 3000, 0.72, 'USDC', 2160, 1.0, 1, datetime('now'), datetime('now')),
('Swap', '2026-02-20 09:00:00', 'USDC', 4000, 1.0, 'SOL', 22, 182, 1, datetime('now'), datetime('now')),
('Swap', '2026-02-24 14:00:00', 'USDC', 2000, 1.0, 'LINK', 110, 18.2, 1, datetime('now'), datetime('now'));
