-- CreateEnum
CREATE TYPE "WalletTxnKind" AS ENUM ('OPENING', 'TOPUP', 'ORDER', 'REFUND', 'CREDIT_NOTE', 'DEBIT_NOTE');

-- CreateEnum
CREATE TYPE "NoteKind" AS ENUM ('CREDIT', 'DEBIT');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN "walletPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "holdPaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "discountPercent" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "chargePaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "chargeSettled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN "accountId" UUID;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "accountId" UUID;

-- CreateTable
CREATE TABLE "WalletTxn" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "kind" "WalletTxnKind" NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "balanceAfterPaise" INTEGER NOT NULL,
    "mode" "PaymentMode",
    "reference" TEXT,
    "narration" TEXT,
    "orderId" UUID,
    "noteId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTxn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountNote" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "kind" "NoteKind" NOT NULL,
    "noteNo" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WalletTxn_tenantId_createdAt_idx" ON "WalletTxn"("tenantId", "createdAt");
CREATE INDEX "WalletTxn_tenantId_accountId_createdAt_idx" ON "WalletTxn"("tenantId", "accountId", "createdAt");
CREATE UNIQUE INDEX "AccountNote_tenantId_noteNo_key" ON "AccountNote"("tenantId", "noteNo");
CREATE INDEX "AccountNote_tenantId_createdAt_idx" ON "AccountNote"("tenantId", "createdAt");
CREATE INDEX "User_accountId_idx" ON "User"("accountId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WalletTxn" ADD CONSTRAINT "WalletTxn_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletTxn" ADD CONSTRAINT "WalletTxn_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountNote" ADD CONSTRAINT "AccountNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountNote" ADD CONSTRAINT "AccountNote_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Orders already billed to an account count as taken from its wallet.
UPDATE "Order" SET "chargePaise" = "netPaise", "chargeSettled" = true WHERE "accountId" IS NOT NULL AND "status" = 'ACTIVE';

-- Carry each account's position over: money received minus orders billed (negative = owes).
UPDATE "Account" a SET "walletPaise" =
  COALESCE((SELECT SUM(p."amountPaise") FROM "AccountPayment" p WHERE p."accountId" = a."id"), 0)
  - COALESCE((SELECT SUM(o."netPaise") FROM "Order" o WHERE o."accountId" = a."id" AND o."status" = 'ACTIVE'), 0);

INSERT INTO "WalletTxn" ("id", "tenantId", "accountId", "kind", "amountPaise", "balanceAfterPaise", "narration")
SELECT gen_random_uuid(), a."tenantId", a."id", 'OPENING', a."walletPaise", a."walletPaise", 'Opening balance carried over'
FROM "Account" a WHERE a."walletPaise" <> 0;

-- Invoices are now statements of orders already taken from the wallet.
UPDATE "Invoice" SET "paidPaise" = "totalPaise", "status" = 'PAID' WHERE "status" = 'ISSUED';
