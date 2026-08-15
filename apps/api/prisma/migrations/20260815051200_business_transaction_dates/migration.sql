-- Add business dates without backfilling from createdAt.
-- Existing rows keep NULL purchaseDate / transactionDate until manually assigned.

-- AlterTable
ALTER TABLE "Purchase" ADD COLUMN "purchaseDate" DATE;

-- Rename receipt business date column (preserves existing values)
ALTER TABLE "PurchaseReceipt" RENAME COLUMN "arrivalDate" TO "receiptDate";

-- RenameIndex
ALTER INDEX "PurchaseReceipt_arrivalDate_idx" RENAME TO "PurchaseReceipt_receiptDate_idx";

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN "transactionDate" DATE;

-- CreateIndex
CREATE INDEX "Purchase_purchaseDate_idx" ON "Purchase"("purchaseDate");

-- CreateIndex
CREATE INDEX "InventoryMovement_transactionDate_idx" ON "InventoryMovement"("transactionDate");
