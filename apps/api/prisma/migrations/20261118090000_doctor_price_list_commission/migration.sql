-- CreateEnum
CREATE TYPE "CommissionMode" AS ENUM ('PERCENT', 'AMOUNT');

-- AlterTable
ALTER TABLE "PriceList" ADD COLUMN "commissionMode" "CommissionMode" NOT NULL DEFAULT 'PERCENT';
ALTER TABLE "PriceListItem" ADD COLUMN "commissionPercent" DOUBLE PRECISION,
ADD COLUMN "commissionPaise" INTEGER;
