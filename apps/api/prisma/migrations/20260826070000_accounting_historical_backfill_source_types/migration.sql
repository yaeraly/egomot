-- AlterEnum
-- Additive source types for historical finance backfill.
-- Does not modify Sales, Purchases, Inventory, or existing journals.

ALTER TYPE "AccountingSourceType" ADD VALUE 'SALE_REVENUE';
ALTER TYPE "AccountingSourceType" ADD VALUE 'SALE_COGS';
ALTER TYPE "AccountingSourceType" ADD VALUE 'PURCHASE';
ALTER TYPE "AccountingSourceType" ADD VALUE 'CARGO';
