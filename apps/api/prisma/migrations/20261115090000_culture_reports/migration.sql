-- Culture & sensitivity reporting: antibiotic list and no-growth template on the test,
-- growth / organisms / sensitivities on the order's test.
ALTER TABLE "Test" ADD COLUMN "reportKind" TEXT NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "Test" ADD COLUMN "cultureConfig" JSONB;
ALTER TABLE "OrderTest" ADD COLUMN "culture" JSONB;
