-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "disabledModules" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "maxBranches" INTEGER,
ADD COLUMN     "maxUsers" INTEGER,
ADD COLUMN     "permissionOverrides" JSONB NOT NULL DEFAULT '{}';

