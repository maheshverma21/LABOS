-- CreateEnum
CREATE TYPE "InstrumentProtocol" AS ENUM ('ASTM', 'HL7');

-- CreateEnum
CREATE TYPE "InstrumentConnection" AS ENUM ('LISTEN', 'CONNECT');

-- CreateEnum
CREATE TYPE "InstrumentMessageStatus" AS ENUM ('APPLIED', 'PARTIAL', 'NOT_APPLIED', 'ERROR');

-- AlterTable
ALTER TABLE "Result" ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "Instrument" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "model" TEXT,
    "protocol" "InstrumentProtocol" NOT NULL DEFAULT 'ASTM',
    "connection" "InstrumentConnection" NOT NULL DEFAULT 'LISTEN',
    "host" TEXT,
    "port" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstrumentMapping" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "analyzerCode" TEXT NOT NULL,
    "parameterId" UUID NOT NULL,
    "factor" DOUBLE PRECISION,

    CONSTRAINT "InstrumentMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstrumentMessage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "instrumentId" UUID NOT NULL,
    "sampleId" TEXT,
    "orderId" UUID,
    "status" "InstrumentMessageStatus" NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "raw" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstrumentMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterfaceKey" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterfaceKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Instrument_tenantId_idx" ON "Instrument"("tenantId");

-- CreateIndex
CREATE INDEX "InstrumentMapping_tenantId_idx" ON "InstrumentMapping"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "InstrumentMapping_instrumentId_analyzerCode_key" ON "InstrumentMapping"("instrumentId", "analyzerCode");

-- CreateIndex
CREATE INDEX "InstrumentMessage_tenantId_instrumentId_createdAt_idx" ON "InstrumentMessage"("tenantId", "instrumentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "InterfaceKey_keyHash_key" ON "InterfaceKey"("keyHash");

-- CreateIndex
CREATE INDEX "InterfaceKey_tenantId_idx" ON "InterfaceKey"("tenantId");

-- AddForeignKey
ALTER TABLE "Instrument" ADD CONSTRAINT "Instrument_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstrumentMapping" ADD CONSTRAINT "InstrumentMapping_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstrumentMapping" ADD CONSTRAINT "InstrumentMapping_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstrumentMessage" ADD CONSTRAINT "InstrumentMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstrumentMessage" ADD CONSTRAINT "InstrumentMessage_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterfaceKey" ADD CONSTRAINT "InterfaceKey_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

