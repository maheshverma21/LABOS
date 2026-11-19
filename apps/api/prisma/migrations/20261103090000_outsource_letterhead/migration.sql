-- AlterTable
ALTER TABLE "ReportTemplate" ADD COLUMN     "outsourceFooterHeightMm" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "outsourceFooterImageId" UUID,
ADD COLUMN     "outsourceHeaderImageId" UUID;
