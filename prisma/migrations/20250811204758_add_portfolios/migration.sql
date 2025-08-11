/*
  Warnings:

  - Added the required column `portfolioId` to the `Transaction` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "Portfolio" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Transaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "asset" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "priceUsd" REAL,
    "quantity" REAL NOT NULL,
    "datetime" DATETIME NOT NULL,
    "feesUsd" REAL,
    "costUsd" REAL,
    "proceedsUsd" REAL,
    "notes" TEXT,
    "portfolioId" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Transaction_portfolioId_fkey" FOREIGN KEY ("portfolioId") REFERENCES "Portfolio" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Seed a default portfolio and attach existing transactions to it
INSERT INTO "Portfolio" ("name", "createdAt", "updatedAt") VALUES ('Default', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
INSERT INTO "new_Transaction" ("asset", "costUsd", "createdAt", "datetime", "feesUsd", "id", "notes", "priceUsd", "proceedsUsd", "quantity", "type", "updatedAt", "portfolioId")
SELECT "asset", "costUsd", "createdAt", "datetime", "feesUsd", "id", "notes", "priceUsd", "proceedsUsd", "quantity", "type", "updatedAt", (SELECT MAX("id") FROM "Portfolio") AS portfolioId FROM "Transaction";
DROP TABLE "Transaction";
ALTER TABLE "new_Transaction" RENAME TO "Transaction";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
