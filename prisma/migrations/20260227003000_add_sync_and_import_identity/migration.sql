-- AlterTable
ALTER TABLE "ExchangeConnection" ADD COLUMN "portfolioId" INTEGER;
ALTER TABLE "ExchangeConnection" ADD COLUMN "autoSyncEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ExchangeConnection" ADD COLUMN "lastSyncAt" DATETIME;
ALTER TABLE "ExchangeConnection" ADD COLUMN "lastAutoSyncAt" DATETIME;
ALTER TABLE "ExchangeConnection" ADD COLUMN "lastSyncStatus" TEXT;
ALTER TABLE "ExchangeConnection" ADD COLUMN "lastSyncMessage" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN "importSource" TEXT;
ALTER TABLE "Transaction" ADD COLUMN "importExternalId" TEXT;

-- CreateIndex
CREATE INDEX "ExchangeConnection_portfolioId_idx" ON "ExchangeConnection"("portfolioId");

-- CreateIndex
CREATE INDEX "ExchangeConnection_userId_autoSyncEnabled_idx" ON "ExchangeConnection"("userId", "autoSyncEnabled");

-- CreateIndex
CREATE INDEX "Transaction_portfolioId_importSource_idx" ON "Transaction"("portfolioId", "importSource");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_portfolioId_importSource_importExternalId_key" ON "Transaction"("portfolioId", "importSource", "importExternalId");
