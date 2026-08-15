-- Add SALES operator role (must be committed before use in same migration batch)
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'SALES';

-- Sale operator and pricing snapshots
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "createdByUserId" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "confirmedByUserId" TEXT;
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "clientTypeAtSale" "ClientType";
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "clientCategoryAtSale" "ClientPricingCategory";

CREATE UNIQUE INDEX IF NOT EXISTS "Sale_idempotencyKey_key" ON "Sale"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "Sale_createdByUserId_idx" ON "Sale"("createdByUserId");
CREATE INDEX IF NOT EXISTS "Sale_confirmedByUserId_idx" ON "Sale"("confirmedByUserId");

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_confirmedByUserId_fkey"
  FOREIGN KEY ("confirmedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Sale item pricing context snapshot
ALTER TABLE "SaleItem" ADD COLUMN IF NOT EXISTS "clientTypeAtSale" "ClientType";
ALTER TABLE "SaleItem" ADD COLUMN IF NOT EXISTS "clientCategoryAtSale" "ClientPricingCategory";
