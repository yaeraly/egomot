-- Rename receipt business date to explicit warehouse receipt date (values preserved).
ALTER TABLE "PurchaseReceipt" RENAME COLUMN "receiptDate" TO "warehouseReceiptDate";

ALTER INDEX "PurchaseReceipt_receiptDate_idx" RENAME TO "PurchaseReceipt_warehouseReceiptDate_idx";
