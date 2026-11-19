-- AlterTable
ALTER TABLE "Patient"
  ADD COLUMN "patientType" TEXT,
  ADD COLUMN "mrn" TEXT,
  ADD COLUMN "nationalId" TEXT,
  ADD COLUMN "phoneBelongsTo" TEXT,
  ADD COLUMN "organisation" TEXT,
  ADD COLUMN "referral" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "district" TEXT,
  ADD COLUMN "passportNumber" TEXT,
  ADD COLUMN "country" TEXT;
