-- AlterTable
ALTER TABLE "Account" ADD COLUMN "city" TEXT,
ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "ReportTemplate" ADD COLUMN "accountId" UUID;

-- CreateIndex
CREATE INDEX "ReportTemplate_accountId_idx" ON "ReportTemplate"("accountId");
