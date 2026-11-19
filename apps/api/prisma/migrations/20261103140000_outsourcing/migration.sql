-- AlterTable
ALTER TABLE "Test" ADD COLUMN     "outsourceLabId" UUID;

-- CreateTable
CREATE TABLE "OutsourceLab" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OutsourceLab_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTestFile" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderTestId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderTestFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OutsourceLab_tenantId_idx" ON "OutsourceLab"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "OutsourceLab_tenantId_name_key" ON "OutsourceLab"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "OrderTestFile_orderTestId_key" ON "OrderTestFile"("orderTestId");

-- CreateIndex
CREATE INDEX "OrderTestFile_tenantId_idx" ON "OrderTestFile"("tenantId");

-- AddForeignKey
ALTER TABLE "Test" ADD CONSTRAINT "Test_outsourceLabId_fkey" FOREIGN KEY ("outsourceLabId") REFERENCES "OutsourceLab"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutsourceLab" ADD CONSTRAINT "OutsourceLab_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTestFile" ADD CONSTRAINT "OrderTestFile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTestFile" ADD CONSTRAINT "OrderTestFile_orderTestId_fkey" FOREIGN KEY ("orderTestId") REFERENCES "OrderTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
