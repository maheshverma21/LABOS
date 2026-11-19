-- CreateEnum
CREATE TYPE "SampleStatus" AS ENUM ('PENDING', 'COLLECTED', 'RECEIVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderTestStatus" AS ENUM ('AWAITING_SAMPLE', 'IN_LAB', 'ENTERED', 'SUBMITTED', 'APPROVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Sample" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "barcode" TEXT NOT NULL,
    "sampleType" TEXT NOT NULL,
    "container" TEXT,
    "status" "SampleStatus" NOT NULL DEFAULT 'PENDING',
    "collectedAt" TIMESTAMP(3),
    "collectedById" UUID,
    "collectedBranchId" UUID,
    "receivedAt" TIMESTAMP(3),
    "receivedById" UUID,
    "rejectedAt" TIMESTAMP(3),
    "rejectedById" UUID,
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTest" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "testId" UUID NOT NULL,
    "sampleId" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentName" TEXT NOT NULL,
    "sampleType" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "OrderTestStatus" NOT NULL DEFAULT 'AWAITING_SAMPLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderTest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Sample_tenantId_status_createdAt_idx" ON "Sample"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Sample_tenantId_orderId_idx" ON "Sample"("tenantId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Sample_tenantId_barcode_key" ON "Sample"("tenantId", "barcode");

-- CreateIndex
CREATE INDEX "OrderTest_tenantId_orderId_idx" ON "OrderTest"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "OrderTest_tenantId_status_idx" ON "OrderTest"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTest" ADD CONSTRAINT "OrderTest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTest" ADD CONSTRAINT "OrderTest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTest" ADD CONSTRAINT "OrderTest_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTest" ADD CONSTRAINT "OrderTest_testId_fkey" FOREIGN KEY ("testId") REFERENCES "Test"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTest" ADD CONSTRAINT "OrderTest_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE SET NULL ON UPDATE CASCADE;

