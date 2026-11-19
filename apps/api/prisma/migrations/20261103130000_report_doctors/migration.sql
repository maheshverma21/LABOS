-- AlterEnum
ALTER TYPE "AssetKind" ADD VALUE 'DOCTOR_SIGNATURE';

-- CreateTable
CREATE TABLE "ReportDoctor" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "degree" TEXT,
    "signatureId" UUID,
    "hideName" BOOLEAN NOT NULL DEFAULT false,
    "position" TEXT NOT NULL DEFAULT 'RIGHT',
    "nameFontSize" INTEGER NOT NULL DEFAULT 12,
    "degreeFontSize" INTEGER NOT NULL DEFAULT 9,
    "signatureSize" INTEGER NOT NULL DEFAULT 41,
    "spacing" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "nameDegreeSpacing" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "alignment" TEXT NOT NULL DEFAULT 'RIGHT',
    "mode" TEXT NOT NULL DEFAULT 'FIXED',
    "endOfReport" BOOLEAN NOT NULL DEFAULT false,
    "departments" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportDoctor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportDoctor_tenantId_idx" ON "ReportDoctor"("tenantId");

-- AddForeignKey
ALTER TABLE "ReportDoctor" ADD CONSTRAINT "ReportDoctor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
