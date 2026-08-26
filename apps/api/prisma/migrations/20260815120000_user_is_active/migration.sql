-- AlterTable
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- Normalize payment method display names
UPDATE "PaymentMethod" SET "name" = 'Банк карта' WHERE "code" = 'BANK_CARD';
