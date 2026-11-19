-- AlterEnum
ALTER TYPE "DeliveryChannel" ADD VALUE 'COUNTER';

-- AlterTable
ALTER TABLE "ReportTemplate" ADD COLUMN     "highColor" TEXT NOT NULL DEFAULT '#B91C1C',
ADD COLUMN     "lowColor" TEXT NOT NULL DEFAULT '#1D4ED8';

