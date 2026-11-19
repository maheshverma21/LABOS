-- Interpretation printed on the report, and the method each parameter is measured by.
ALTER TABLE "Test" ADD COLUMN "interpretation" TEXT;
ALTER TABLE "Parameter" ADD COLUMN "method" TEXT;
