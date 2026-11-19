-- Patient-wise barcodes: every tube of a visit can carry the same barcode,
-- so a barcode is no longer unique per lab (new barcodes are still checked in the app).
DROP INDEX "Sample_tenantId_barcode_key";
CREATE INDEX "Sample_tenantId_barcode_idx" ON "Sample"("tenantId", "barcode");
