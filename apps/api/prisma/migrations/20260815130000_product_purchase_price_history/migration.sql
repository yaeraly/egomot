-- CreateTable
CREATE TABLE "ProductPurchasePriceHistory" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "purchaseId" TEXT,
    "previousPriceCny" DECIMAL(12,2),
    "newPriceCny" DECIMAL(12,2) NOT NULL,
    "changedByUserId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductPurchasePriceHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductPurchasePriceHistory_productId_changedAt_idx" ON "ProductPurchasePriceHistory"("productId", "changedAt");

-- CreateIndex
CREATE INDEX "ProductPurchasePriceHistory_purchaseId_idx" ON "ProductPurchasePriceHistory"("purchaseId");

-- AddForeignKey
ALTER TABLE "ProductPurchasePriceHistory" ADD CONSTRAINT "ProductPurchasePriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPurchasePriceHistory" ADD CONSTRAINT "ProductPurchasePriceHistory_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductPurchasePriceHistory" ADD CONSTRAINT "ProductPurchasePriceHistory_changedByUserId_fkey" FOREIGN KEY ("changedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
