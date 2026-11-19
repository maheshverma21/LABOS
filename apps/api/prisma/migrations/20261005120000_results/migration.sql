-- CreateEnum
CREATE TYPE "ResultFlag" AS ENUM ('CRITICAL_LOW', 'LOW', 'NORMAL', 'HIGH', 'CRITICAL_HIGH');

-- AlterTable
ALTER TABLE "OrderTest" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" UUID,
ADD COLUMN     "enteredAt" TIMESTAMP(3),
ADD COLUMN     "enteredById" UUID,
ADD COLUMN     "remarks" TEXT,
ADD COLUMN     "sendBackNote" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Result" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderTestId" UUID NOT NULL,
    "parameterId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "resultType" "ResultType" NOT NULL,
    "decimals" INTEGER NOT NULL,
    "value" TEXT,
    "numericValue" DOUBLE PRECISION,
    "flag" "ResultFlag",
    "isCalculated" BOOLEAN NOT NULL DEFAULT false,
    "refLow" DOUBLE PRECISION,
    "refHigh" DOUBLE PRECISION,
    "refCritLow" DOUBLE PRECISION,
    "refCritHigh" DOUBLE PRECISION,
    "refText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "enteredById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Result_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Result_tenantId_parameterId_idx" ON "Result"("tenantId", "parameterId");

-- CreateIndex
CREATE UNIQUE INDEX "Result_orderTestId_parameterId_key" ON "Result"("orderTestId", "parameterId");

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_orderTestId_fkey" FOREIGN KEY ("orderTestId") REFERENCES "OrderTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Result" ADD CONSTRAINT "Result_parameterId_fkey" FOREIGN KEY ("parameterId") REFERENCES "Parameter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

