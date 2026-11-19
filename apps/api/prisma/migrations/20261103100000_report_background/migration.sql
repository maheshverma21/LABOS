-- AlterEnum
ALTER TYPE "AssetKind" ADD VALUE 'BACKGROUND';

-- AlterTable
ALTER TABLE "ReportTemplate" ADD COLUMN     "backgroundImageId" UUID;
