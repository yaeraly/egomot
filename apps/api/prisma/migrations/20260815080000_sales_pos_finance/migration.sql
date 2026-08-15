-- CreateEnum
CREATE TYPE "ClientDebtTransactionType" AS ENUM ('SALE_DEBT', 'DEBT_PAYMENT');

-- CreateEnum
CREATE TYPE "FinancialTransactionType" AS ENUM ('SALE_PAYMENT', 'DEBT_PAYMENT');

-- AlterEnum
ALTER TYPE "InventoryMovementType" ADD VALUE 'SALE';

-- AlterEnum
ALTER TYPE "InventoryReferenceType" ADD VALUE 'SALE';

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN "soldByUserId" TEXT,
ADD COLUMN "debtAmountKgs" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN "confirmedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialTransaction" (
    "id" TEXT NOT NULL,
    "type" "FinancialTransactionType" NOT NULL,
    "paymentAccountId" TEXT NOT NULL,
    "saleId" TEXT,
    "paymentId" TEXT,
    "amountKgs" DECIMAL(14,2) NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "transactionAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientDebtTransaction" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "saleId" TEXT,
    "type" "ClientDebtTransactionType" NOT NULL,
    "amountKgs" DECIMAL(14,2) NOT NULL,
    "balanceAfterKgs" DECIMAL(14,2) NOT NULL,
    "recordedByUserId" TEXT NOT NULL,
    "paymentId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientDebtTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleReceipt" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleReceipt_pkey" PRIMARY KEY ("id")
);

-- Drop old Payment rows (schema incompatible; no production sales data expected)
DELETE FROM "Payment";

-- AlterTable Payment — add finance columns
ALTER TABLE "Payment" ADD COLUMN "paymentMethodId" TEXT,
ADD COLUMN "paymentAccountId" TEXT,
ADD COLUMN "receivedByUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_code_key" ON "PaymentMethod"("code");

-- CreateIndex
CREATE INDEX "PaymentMethod_isActive_idx" ON "PaymentMethod"("isActive");

-- CreateIndex
CREATE INDEX "PaymentMethod_sortOrder_idx" ON "PaymentMethod"("sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAccount_userId_paymentMethodId_key" ON "PaymentAccount"("userId", "paymentMethodId");

-- CreateIndex
CREATE INDEX "PaymentAccount_userId_idx" ON "PaymentAccount"("userId");

-- CreateIndex
CREATE INDEX "PaymentAccount_paymentMethodId_idx" ON "PaymentAccount"("paymentMethodId");

-- CreateIndex
CREATE INDEX "PaymentAccount_isActive_idx" ON "PaymentAccount"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialTransaction_paymentId_key" ON "FinancialTransaction"("paymentId");

-- CreateIndex
CREATE INDEX "FinancialTransaction_paymentAccountId_idx" ON "FinancialTransaction"("paymentAccountId");

-- CreateIndex
CREATE INDEX "FinancialTransaction_saleId_idx" ON "FinancialTransaction"("saleId");

-- CreateIndex
CREATE INDEX "FinancialTransaction_recordedByUserId_idx" ON "FinancialTransaction"("recordedByUserId");

-- CreateIndex
CREATE INDEX "FinancialTransaction_transactionAt_idx" ON "FinancialTransaction"("transactionAt");

-- CreateIndex
CREATE INDEX "FinancialTransaction_type_idx" ON "FinancialTransaction"("type");

-- CreateIndex
CREATE UNIQUE INDEX "ClientDebtTransaction_paymentId_key" ON "ClientDebtTransaction"("paymentId");

-- CreateIndex
CREATE INDEX "ClientDebtTransaction_clientId_idx" ON "ClientDebtTransaction"("clientId");

-- CreateIndex
CREATE INDEX "ClientDebtTransaction_saleId_idx" ON "ClientDebtTransaction"("saleId");

-- CreateIndex
CREATE INDEX "ClientDebtTransaction_recordedByUserId_idx" ON "ClientDebtTransaction"("recordedByUserId");

-- CreateIndex
CREATE INDEX "ClientDebtTransaction_createdAt_idx" ON "ClientDebtTransaction"("createdAt");

-- CreateIndex
CREATE INDEX "ClientDebtTransaction_type_idx" ON "ClientDebtTransaction"("type");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReceipt_saleId_key" ON "SaleReceipt"("saleId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleReceipt_number_key" ON "SaleReceipt"("number");

-- CreateIndex
CREATE INDEX "SaleReceipt_number_idx" ON "SaleReceipt"("number");

-- CreateIndex
CREATE INDEX "Sale_soldByUserId_idx" ON "Sale"("soldByUserId");

-- CreateIndex
CREATE INDEX "Sale_confirmedAt_idx" ON "Sale"("confirmedAt");

-- CreateIndex
CREATE INDEX "Payment_paymentMethodId_idx" ON "Payment"("paymentMethodId");

-- CreateIndex
CREATE INDEX "Payment_paymentAccountId_idx" ON "Payment"("paymentAccountId");

-- CreateIndex
CREATE INDEX "Payment_receivedByUserId_idx" ON "Payment"("receivedByUserId");

-- AddForeignKey
ALTER TABLE "Sale" ADD CONSTRAINT "Sale_soldByUserId_fkey" FOREIGN KEY ("soldByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAccount" ADD CONSTRAINT "PaymentAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAccount" ADD CONSTRAINT "PaymentAccount_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_receivedByUserId_fkey" FOREIGN KEY ("receivedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDebtTransaction" ADD CONSTRAINT "ClientDebtTransaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDebtTransaction" ADD CONSTRAINT "ClientDebtTransaction_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDebtTransaction" ADD CONSTRAINT "ClientDebtTransaction_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientDebtTransaction" ADD CONSTRAINT "ClientDebtTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleReceipt" ADD CONSTRAINT "SaleReceipt_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed default payment methods
INSERT INTO "PaymentMethod" ("id", "code", "name", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES
  (gen_random_uuid()::text, 'CASH', 'Наличные', true, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'MBANK', 'MBank', true, 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ELCART', 'Элсом', true, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'ODENGI', 'О!Деньги', true, 4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'BANK_CARD', 'Bank Card', true, 5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'OTHER', 'Other', true, 6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- Create payment accounts for each existing user
INSERT INTO "PaymentAccount" ("id", "userId", "paymentMethodId", "name", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, u."id", pm."id", u."name" || ' — ' || pm."name", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "User" u
CROSS JOIN "PaymentMethod" pm
WHERE pm."isActive" = true;
