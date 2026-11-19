-- CreateEnum
CREATE TYPE "PriceListType" AS ENUM ('DOCTOR', 'HOSPITAL', 'B2B');

-- AlterTable
ALTER TABLE "PriceList" ADD COLUMN "type" "PriceListType" NOT NULL DEFAULT 'B2B';
ALTER TABLE "Doctor" ADD COLUMN "priceListId" UUID;

-- Lists already used by hospital accounts are hospital lists.
UPDATE "PriceList" SET "type" = 'HOSPITAL'
WHERE "id" IN (SELECT "priceListId" FROM "Account" WHERE "type" = 'HOSPITAL' AND "priceListId" IS NOT NULL);

-- AddForeignKey
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "PriceList"("id") ON DELETE SET NULL ON UPDATE CASCADE;
