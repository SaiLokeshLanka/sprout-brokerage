-- CreateEnum
CREATE TYPE "GttKind" AS ENUM ('SINGLE', 'OCO');

-- CreateEnum
CREATE TYPE "GttStatus" AS ENUM ('ACTIVE', 'TRIGGERED', 'CANCELLED', 'EXPIRED', 'FAILED');

-- AlterEnum
ALTER TYPE "JournalType" ADD VALUE 'CHARGES';

-- AlterEnum
ALTER TYPE "LedgerAccountType" ADD VALUE 'SYSTEM_CHARGES';

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'TRIGGER_PENDING';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OrderType" ADD VALUE 'SL';
ALTER TYPE "OrderType" ADD VALUE 'SL_M';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "chargesPaise" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "triggerPricePaise" INTEGER;

-- AlterTable
ALTER TABLE "trades" ADD COLUMN     "charges" JSONB,
ADD COLUMN     "chargesPaise" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "gtts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "kind" "GttKind" NOT NULL,
    "qty" INTEGER NOT NULL,
    "triggerPricePaise" INTEGER NOT NULL,
    "limitPricePaise" INTEGER NOT NULL,
    "stopTriggerPricePaise" INTEGER,
    "stopLimitPricePaise" INTEGER,
    "ltpAtCreationPaise" INTEGER NOT NULL,
    "status" "GttStatus" NOT NULL DEFAULT 'ACTIVE',
    "triggeredLeg" TEXT,
    "orderId" TEXT,
    "statusReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "triggeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gtts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "gtts_userId_createdAt_idx" ON "gtts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "gtts_status_idx" ON "gtts"("status");

-- AddForeignKey
ALTER TABLE "gtts" ADD CONSTRAINT "gtts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
