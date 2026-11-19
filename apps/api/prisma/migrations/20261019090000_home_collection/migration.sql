-- CreateEnum
CREATE TYPE "HomeVisitStatus" AS ENUM ('BOOKED', 'ASSIGNED', 'EN_ROUTE', 'COLLECTED', 'MISSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "HomeVisit" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "branchId" UUID,
    "status" "HomeVisitStatus" NOT NULL DEFAULT 'BOOKED',
    "scheduledDate" DATE NOT NULL,
    "slot" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "landmark" TEXT,
    "pincode" TEXT,
    "contactPhone" TEXT NOT NULL,
    "feePaise" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "assignedToId" UUID,
    "startedAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3),
    "missedReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HomeVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HomeVisit_orderId_key" ON "HomeVisit"("orderId");

-- CreateIndex
CREATE INDEX "HomeVisit_tenantId_scheduledDate_idx" ON "HomeVisit"("tenantId", "scheduledDate");

-- CreateIndex
CREATE INDEX "HomeVisit_tenantId_assignedToId_scheduledDate_idx" ON "HomeVisit"("tenantId", "assignedToId", "scheduledDate");

-- AddForeignKey
ALTER TABLE "HomeVisit" ADD CONSTRAINT "HomeVisit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeVisit" ADD CONSTRAINT "HomeVisit_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

