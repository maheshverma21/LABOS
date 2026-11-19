-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('WHATSAPP', 'LINK');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('SENT', 'FAILED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "qualification" TEXT,
ADD COLUMN     "registrationNo" TEXT;

-- AlterTable
ALTER TABLE "OrderTest" ADD COLUMN     "amendedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ReportLink" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportDelivery" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "channel" "DeliveryChannel" NOT NULL,
    "to" TEXT,
    "status" "DeliveryStatus" NOT NULL,
    "error" TEXT,
    "providerRef" TEXT,
    "sentById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportLink_token_key" ON "ReportLink"("token");

-- CreateIndex
CREATE INDEX "ReportLink_tenantId_orderId_idx" ON "ReportLink"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "ReportDelivery_tenantId_orderId_idx" ON "ReportDelivery"("tenantId", "orderId");

-- CreateIndex
CREATE INDEX "ReportDelivery_tenantId_createdAt_idx" ON "ReportDelivery"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "ReportLink" ADD CONSTRAINT "ReportLink_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportLink" ADD CONSTRAINT "ReportLink_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDelivery" ADD CONSTRAINT "ReportDelivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDelivery" ADD CONSTRAINT "ReportDelivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

