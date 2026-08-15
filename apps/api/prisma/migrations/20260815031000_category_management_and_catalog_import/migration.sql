-- Rename ProductCategory to Category and add slug/isActive without data loss
ALTER TABLE "ProductCategory" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "ProductCategory" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

UPDATE "ProductCategory"
SET "slug" = 'category-' || substring("id", 1, 8)
WHERE "slug" IS NULL OR "slug" = '';

ALTER TABLE "ProductCategory" RENAME TO "Category";

CREATE UNIQUE INDEX IF NOT EXISTS "Category_slug_key" ON "Category"("slug");
ALTER TABLE "Category" ALTER COLUMN "slug" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "Category_isActive_idx" ON "Category"("isActive");
CREATE INDEX IF NOT EXISTS "Category_slug_idx" ON "Category"("slug");

-- Adjust product decimal precision
ALTER TABLE "Product" ALTER COLUMN "unitWeightKg" TYPE DECIMAL(12,3);
ALTER TABLE "Product" ALTER COLUMN "defaultPurchasePriceCny" TYPE DECIMAL(12,2);

-- Stable unique product name for idempotent catalog import
CREATE UNIQUE INDEX IF NOT EXISTS "Product_name_key" ON "Product"("name");
