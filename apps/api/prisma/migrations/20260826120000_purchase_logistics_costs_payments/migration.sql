-- Purchase logistics costs: payment status, multi-currency original amounts,
-- transport AP, and later debt payments. Does not rewrite posted journals.

ALTER TYPE "AccountingSourceType" ADD VALUE 'LOGISTICS_CHINA';
ALTER TYPE "AccountingSourceType" ADD VALUE 'LOGISTICS_KYRGYZSTAN';
ALTER TYPE "AccountingSourceType" ADD VALUE 'LOGISTICS_CHINA_PAYMENT';
ALTER TYPE "AccountingSourceType" ADD VALUE 'LOGISTICS_KYRGYZSTAN_PAYMENT';

ALTER TABLE "PurchaseLogisticsExpense" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(18,6);

ALTER TABLE "PurchaseLogisticsExpense"
  ADD COLUMN "expenseDate" DATE,
  ADD COLUMN "payeeName" TEXT,
  ADD COLUMN "paidAmountKgs" DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "remainingAmountKgs" DECIMAL(14,2),
  ADD COLUMN "status" "PayableStatus" NOT NULL DEFAULT 'UNPAID',
  ADD COLUMN "paymentAccountId" TEXT,
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "journalId" TEXT,
  ADD COLUMN "cargoPayableId" TEXT,
  ADD COLUMN "transportPayableId" TEXT,
  ADD COLUMN "createdByUserId" TEXT;

UPDATE "PurchaseLogisticsExpense"
SET
  "expenseDate" = ("createdAt" AT TIME ZONE 'UTC')::date,
  "remainingAmountKgs" = "amountKgs",
  "paidAmountKgs" = 0,
  "status" = 'UNPAID'
WHERE "expenseDate" IS NULL OR "remainingAmountKgs" IS NULL;

ALTER TABLE "PurchaseLogisticsExpense" ALTER COLUMN "expenseDate" SET NOT NULL;
ALTER TABLE "PurchaseLogisticsExpense" ALTER COLUMN "remainingAmountKgs" SET NOT NULL;

CREATE UNIQUE INDEX "PurchaseLogisticsExpense_journalId_key" ON "PurchaseLogisticsExpense"("journalId");
CREATE UNIQUE INDEX "PurchaseLogisticsExpense_cargoPayableId_key" ON "PurchaseLogisticsExpense"("cargoPayableId");
CREATE UNIQUE INDEX "PurchaseLogisticsExpense_transportPayableId_key" ON "PurchaseLogisticsExpense"("transportPayableId");
CREATE INDEX "PurchaseLogisticsExpense_status_idx" ON "PurchaseLogisticsExpense"("status");
CREATE INDEX "PurchaseLogisticsExpense_expenseDate_idx" ON "PurchaseLogisticsExpense"("expenseDate");

CREATE TABLE "TransportPayable" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "type" "LogisticsType" NOT NULL,
    "payeeName" TEXT,
    "amountKgs" DECIMAL(14,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'KGS',
    "originalAmount" DECIMAL(18,6) NOT NULL,
    "paidAmountKgs" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "remainingAmountKgs" DECIMAL(14,2) NOT NULL,
    "status" "PayableStatus" NOT NULL DEFAULT 'UNPAID',
    "journalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportPayable_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransportPayable_journalId_key" ON "TransportPayable"("journalId");
CREATE INDEX "TransportPayable_purchaseId_idx" ON "TransportPayable"("purchaseId");
CREATE INDEX "TransportPayable_type_idx" ON "TransportPayable"("type");
CREATE INDEX "TransportPayable_status_idx" ON "TransportPayable"("status");

CREATE TABLE "LogisticsPayment" (
    "id" TEXT NOT NULL,
    "logisticsExpenseId" TEXT NOT NULL,
    "amountKgs" DECIMAL(14,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "paymentAccountId" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "note" TEXT,
    "isRecognition" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogisticsPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LogisticsPayment_journalId_key" ON "LogisticsPayment"("journalId");
CREATE INDEX "LogisticsPayment_logisticsExpenseId_idx" ON "LogisticsPayment"("logisticsExpenseId");
CREATE INDEX "LogisticsPayment_paidAt_idx" ON "LogisticsPayment"("paidAt");
CREATE INDEX "LogisticsPayment_paymentAccountId_idx" ON "LogisticsPayment"("paymentAccountId");

INSERT INTO "ChartAccount" ("id", "code", "name", "type", "isActive", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, '2020', 'Transport Accounts Payable', 'LIABILITY', true, 65, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "ChartAccount" WHERE "code" = '2020');

ALTER TABLE "PurchaseLogisticsExpense" ADD CONSTRAINT "PurchaseLogisticsExpense_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseLogisticsExpense" ADD CONSTRAINT "PurchaseLogisticsExpense_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseLogisticsExpense" ADD CONSTRAINT "PurchaseLogisticsExpense_cargoPayableId_fkey" FOREIGN KEY ("cargoPayableId") REFERENCES "CargoPayable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseLogisticsExpense" ADD CONSTRAINT "PurchaseLogisticsExpense_transportPayableId_fkey" FOREIGN KEY ("transportPayableId") REFERENCES "TransportPayable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseLogisticsExpense" ADD CONSTRAINT "PurchaseLogisticsExpense_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "TransportPayable" ADD CONSTRAINT "TransportPayable_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TransportPayable" ADD CONSTRAINT "TransportPayable_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LogisticsPayment" ADD CONSTRAINT "LogisticsPayment_logisticsExpenseId_fkey" FOREIGN KEY ("logisticsExpenseId") REFERENCES "PurchaseLogisticsExpense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LogisticsPayment" ADD CONSTRAINT "LogisticsPayment_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "PaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LogisticsPayment" ADD CONSTRAINT "LogisticsPayment_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LogisticsPayment" ADD CONSTRAINT "LogisticsPayment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
