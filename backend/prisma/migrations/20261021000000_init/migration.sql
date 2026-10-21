-- CreateEnum
CREATE TYPE "Exchange" AS ENUM ('NSE', 'BSE');

-- CreateEnum
CREATE TYPE "InstrumentType" AS ENUM ('EQUITY', 'INDEX');

-- CreateTable
CREATE TABLE "instruments" (
    "id" SERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" "Exchange" NOT NULL DEFAULT 'NSE',
    "name" TEXT NOT NULL,
    "type" "InstrumentType" NOT NULL DEFAULT 'EQUITY',
    "sector" TEXT,
    "lotSize" INTEGER NOT NULL DEFAULT 1,
    "tickSizePaise" INTEGER NOT NULL DEFAULT 5,
    "refPricePaise" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "instruments_type_idx" ON "instruments"("type");

-- CreateIndex
CREATE UNIQUE INDEX "instruments_exchange_symbol_key" ON "instruments"("exchange", "symbol");

