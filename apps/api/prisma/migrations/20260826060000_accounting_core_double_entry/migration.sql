-- CreateEnum
CREATE TYPE "ChartAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'COGS', 'EXPENSE');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PayableStatus" AS ENUM ('UNPAID', 'PARTIAL', 'PAID');

-- CreateEnum
CREATE TYPE "OperatingExpenseCategory" AS ENUM ('WAREHOUSE_RENT', 'STATIONERY', 'OWNER_SALARY', 'OTHER');

-- CreateEnum
CREATE TYPE "AccountingSourceType" AS ENUM ('OPENING_BALANCE', 'PURCHASE_RECEIPT', 'PURCHASE_PAYMENT', 'CARGO_PAYMENT', 'SALE', 'SALE_DEBT_PAYMENT', 'OPERATING_EXPENSE', 'OWNER_WITHDRAWAL', 'REVERSAL');

-- AlterTable Purchase: accounting settlement fields. Do not invent payments.
ALTER TABLE "Purchase" ADD COLUMN "paidAmountKgs" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "Purchase" ADD COLUMN "unpaidAmountKgs" DECIMAL(14,2) NOT NULL DEFAULT 0;
ALTER TABLE "Purchase" ADD COLUMN "payableStatus" "PayableStatus" NOT NULL DEFAULT 'UNPAID';

UPDATE "Purchase"
SET "unpaidAmountKgs" = "estimatedTotalLandedCostKgs",
    "paidAmountKgs" = 0,
    "payableStatus" = 'UNPAID';

CREATE INDEX "Purchase_payableStatus_idx" ON "Purchase"("payableStatus");

-- AlterTable PaymentAccount: company cash/bank custody, optional chart link
ALTER TABLE "PaymentAccount" ADD COLUMN "isCompanyAccount" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PaymentAccount" ADD COLUMN "chartAccountId" TEXT;

CREATE INDEX "PaymentAccount_isCompanyAccount_idx" ON "PaymentAccount"("isCompanyAccount");
CREATE INDEX "PaymentAccount_chartAccountId_idx" ON "PaymentAccount"("chartAccountId");

-- CreateTable
CREATE TABLE "ChartAccount" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ChartAccountType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChartAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChartAccount_code_key" ON "ChartAccount"("code");
CREATE INDEX "ChartAccount_type_idx" ON "ChartAccount"("type");
CREATE INDEX "ChartAccount_isActive_idx" ON "ChartAccount"("isActive");
CREATE INDEX "ChartAccount_sortOrder_idx" ON "ChartAccount"("sortOrder");

INSERT INTO "ChartAccount" ("id", "code", "name", "type", "isActive", "sortOrder", "createdAt", "updatedAt") VALUES
  (gen_random_uuid()::text, '1000', 'Cash', 'ASSET', true, 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '1010', 'Bank', 'ASSET', true, 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '1100', 'Accounts Receivable', 'ASSET', true, 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '1200', 'Inventory', 'ASSET', true, 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '2000', 'Supplier Accounts Payable', 'LIABILITY', true, 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '2010', 'Cargo Accounts Payable', 'LIABILITY', true, 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '3000', 'Investor Capital', 'EQUITY', true, 70, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '3010', 'Owner Drawings', 'EQUITY', true, 80, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '3020', 'Retained Earnings', 'EQUITY', true, 90, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '4000', 'Sales Revenue', 'INCOME', true, 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '5000', 'COGS', 'COGS', true, 110, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '6000', 'Warehouse Rent', 'EXPENSE', true, 120, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '6010', 'Stationery', 'EXPENSE', true, 130, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '6020', 'Owner Salary', 'EXPENSE', true, 140, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, '6030', 'Other Operating Expenses', 'EXPENSE', true, 150, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

ALTER TABLE "PaymentAccount" ADD CONSTRAINT "PaymentAccount_chartAccountId_fkey" FOREIGN KEY ("chartAccountId") REFERENCES "ChartAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "AccountingPeriod" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountingPeriod_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountingPeriod_status_idx" ON "AccountingPeriod"("status");
CREATE INDEX "AccountingPeriod_startsOn_endsOn_idx" ON "AccountingPeriod"("startsOn", "endsOn");

-- CreateTable
CREATE TABLE "Journal" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" "JournalStatus" NOT NULL DEFAULT 'POSTED',
    "sourceType" "AccountingSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "memo" TEXT,
    "periodId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversesJournalId" TEXT,

    CONSTRAINT "Journal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Journal_number_key" ON "Journal"("number");
CREATE UNIQUE INDEX "Journal_reversesJournalId_key" ON "Journal"("reversesJournalId");
CREATE INDEX "Journal_status_idx" ON "Journal"("status");
CREATE INDEX "Journal_sourceType_sourceId_idx" ON "Journal"("sourceType", "sourceId");
CREATE INDEX "Journal_createdByUserId_idx" ON "Journal"("createdByUserId");
CREATE INDEX "Journal_postedAt_idx" ON "Journal"("postedAt");
CREATE INDEX "Journal_periodId_idx" ON "Journal"("periodId");

ALTER TABLE "Journal" ADD CONSTRAINT "Journal_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "AccountingPeriod"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Journal" ADD CONSTRAINT "Journal_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Journal" ADD CONSTRAINT "Journal_reversesJournalId_fkey" FOREIGN KEY ("reversesJournalId") REFERENCES "Journal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debitKgs" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creditKgs" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "memo" TEXT,
    "paymentAccountId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "JournalLine_journalId_idx" ON "JournalLine"("journalId");
CREATE INDEX "JournalLine_accountId_idx" ON "JournalLine"("accountId");
CREATE INDEX "JournalLine_paymentAccountId_idx" ON "JournalLine"("paymentAccountId");

ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CargoVendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CargoVendor_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CargoVendor_name_idx" ON "CargoVendor"("name");
CREATE INDEX "CargoVendor_isActive_idx" ON "CargoVendor"("isActive");

-- CreateTable
CREATE TABLE "SupplierPayable" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "invoiceRef" TEXT,
    "amountKgs" DECIMAL(14,2) NOT NULL,
    "paidAmountKgs" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "remainingAmountKgs" DECIMAL(14,2) NOT NULL,
    "dueDate" DATE,
    "status" "PayableStatus" NOT NULL DEFAULT 'UNPAID',
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierPayable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierPayable_journalId_key" ON "SupplierPayable"("journalId");
CREATE UNIQUE INDEX "SupplierPayable_purchaseId_key" ON "SupplierPayable"("purchaseId");
CREATE INDEX "SupplierPayable_supplierId_idx" ON "SupplierPayable"("supplierId");
CREATE INDEX "SupplierPayable_status_idx" ON "SupplierPayable"("status");

ALTER TABLE "SupplierPayable" ADD CONSTRAINT "SupplierPayable_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayable" ADD CONSTRAINT "SupplierPayable_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupplierPayable" ADD CONSTRAINT "SupplierPayable_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CargoPayable" (
    "id" TEXT NOT NULL,
    "cargoVendorId" TEXT,
    "purchaseId" TEXT NOT NULL,
    "billRef" TEXT,
    "amountKgs" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'KGS',
    "paidAmountKgs" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "remainingAmountKgs" DECIMAL(14,2) NOT NULL,
    "dueDate" DATE,
    "status" "PayableStatus" NOT NULL DEFAULT 'UNPAID',
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CargoPayable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CargoPayable_journalId_key" ON "CargoPayable"("journalId");
CREATE INDEX "CargoPayable_cargoVendorId_idx" ON "CargoPayable"("cargoVendorId");
CREATE INDEX "CargoPayable_purchaseId_idx" ON "CargoPayable"("purchaseId");
CREATE INDEX "CargoPayable_status_idx" ON "CargoPayable"("status");

ALTER TABLE "CargoPayable" ADD CONSTRAINT "CargoPayable_cargoVendorId_fkey" FOREIGN KEY ("cargoVendorId") REFERENCES "CargoVendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CargoPayable" ADD CONSTRAINT "CargoPayable_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CargoPayable" ADD CONSTRAINT "CargoPayable_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "PurchasePayment" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "amountKgs" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "paymentAccountId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchasePayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchasePayment_journalId_key" ON "PurchasePayment"("journalId");
CREATE INDEX "PurchasePayment_purchaseId_idx" ON "PurchasePayment"("purchaseId");
CREATE INDEX "PurchasePayment_paidAt_idx" ON "PurchasePayment"("paidAt");
CREATE INDEX "PurchasePayment_paymentAccountId_idx" ON "PurchasePayment"("paymentAccountId");

ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "CargoPayment" (
    "id" TEXT NOT NULL,
    "cargoPayableId" TEXT NOT NULL,
    "amountKgs" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "paymentAccountId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CargoPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CargoPayment_journalId_key" ON "CargoPayment"("journalId");
CREATE INDEX "CargoPayment_cargoPayableId_idx" ON "CargoPayment"("cargoPayableId");
CREATE INDEX "CargoPayment_paidAt_idx" ON "CargoPayment"("paidAt");

ALTER TABLE "CargoPayment" ADD CONSTRAINT "CargoPayment_cargoPayableId_fkey" FOREIGN KEY ("cargoPayableId") REFERENCES "CargoPayable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CargoPayment" ADD CONSTRAINT "CargoPayment_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CargoPayment" ADD CONSTRAINT "CargoPayment_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CargoPayment" ADD CONSTRAINT "CargoPayment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "OperatingExpense" (
    "id" TEXT NOT NULL,
    "expenseDate" DATE NOT NULL,
    "category" "OperatingExpenseCategory" NOT NULL,
    "amountKgs" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'KGS',
    "accountId" TEXT NOT NULL,
    "paymentAccountId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "journalId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatingExpense_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperatingExpense_journalId_key" ON "OperatingExpense"("journalId");
CREATE INDEX "OperatingExpense_expenseDate_idx" ON "OperatingExpense"("expenseDate");
CREATE INDEX "OperatingExpense_category_idx" ON "OperatingExpense"("category");
CREATE INDEX "OperatingExpense_accountId_idx" ON "OperatingExpense"("accountId");
CREATE INDEX "OperatingExpense_paymentAccountId_idx" ON "OperatingExpense"("paymentAccountId");

ALTER TABLE "OperatingExpense" ADD CONSTRAINT "OperatingExpense_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ChartAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperatingExpense" ADD CONSTRAINT "OperatingExpense_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperatingExpense" ADD CONSTRAINT "OperatingExpense_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OperatingExpense" ADD CONSTRAINT "OperatingExpense_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "OwnerWithdrawal" (
    "id" TEXT NOT NULL,
    "withdrawnAt" DATE NOT NULL,
    "amountKgs" DECIMAL(14,2) NOT NULL,
    "paymentAccountId" TEXT NOT NULL,
    "description" TEXT,
    "journalId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OwnerWithdrawal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OwnerWithdrawal_journalId_key" ON "OwnerWithdrawal"("journalId");
CREATE INDEX "OwnerWithdrawal_withdrawnAt_idx" ON "OwnerWithdrawal"("withdrawnAt");
CREATE INDEX "OwnerWithdrawal_paymentAccountId_idx" ON "OwnerWithdrawal"("paymentAccountId");

ALTER TABLE "OwnerWithdrawal" ADD CONSTRAINT "OwnerWithdrawal_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OwnerWithdrawal" ADD CONSTRAINT "OwnerWithdrawal_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OwnerWithdrawal" ADD CONSTRAINT "OwnerWithdrawal_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
