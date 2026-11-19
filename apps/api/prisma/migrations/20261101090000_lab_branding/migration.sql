-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('LOGO', 'HEADER', 'FOOTER', 'SIGNATURE', 'STAMP');

-- CreateEnum
CREATE TYPE "LetterheadStyle" AS ENUM ('BUILT_IN', 'IMAGE', 'PREPRINTED');

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "accreditation" TEXT,
ADD COLUMN     "address" TEXT,
ADD COLUMN     "logoId" UUID,
ADD COLUMN     "tagline" TEXT,
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "signatureId" UUID,
ADD COLUMN     "stampId" UUID;

-- CreateTable
CREATE TABLE "LabAsset" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LabAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportTemplate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "style" "LetterheadStyle" NOT NULL DEFAULT 'BUILT_IN',
    "headerImageId" UUID,
    "footerImageId" UUID,
    "headerHeightMm" INTEGER NOT NULL DEFAULT 35,
    "footerHeightMm" INTEGER NOT NULL DEFAULT 20,
    "accentColor" TEXT NOT NULL DEFAULT '#2D6A9F',
    "showLogo" BOOLEAN NOT NULL DEFAULT true,
    "showSignatures" BOOLEAN NOT NULL DEFAULT true,
    "showQr" BOOLEAN NOT NULL DEFAULT true,
    "footerNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabAsset_tenantId_idx" ON "LabAsset"("tenantId");

-- CreateIndex
CREATE INDEX "ReportTemplate_tenantId_idx" ON "ReportTemplate"("tenantId");

-- AddForeignKey
ALTER TABLE "LabAsset" ADD CONSTRAINT "LabAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportTemplate" ADD CONSTRAINT "ReportTemplate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

