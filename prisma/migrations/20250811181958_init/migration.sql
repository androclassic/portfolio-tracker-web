-- CreateTable
CREATE TABLE "Transaction" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
